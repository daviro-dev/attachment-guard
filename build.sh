#!/usr/bin/env bash
#
# Build attachment-guard.xpi from the source files in this directory.
#
# Usage:
#   ./build.sh            # -> ./web-ext-artifacts/attachment-guard-<version>.xpi
#   ./build.sh out.xpi    # -> ./out.xpi
#   ./build.sh dist       # lint + build a clean, release-ready .xpi
#
# This is a self-distributed Thunderbird MailExtension. It is NOT on
# addons.thunderbird.net (ATN): ATN does not accept new submissions using
# Experiment APIs, and this add-on ships the FilterTerm experiment. Thunderbird
# does not require signing, so the .xpi below installs as-is.
# The 'dist' target just runs web-ext lint and packages a clean artifact.
# See RELEASING.md.
set -euo pipefail

cd "$(dirname "$0")"

# --- What ships -------------------------------------------------------------
# The build is an ALLOWLIST: only these paths are added to the archive, so
# everything else in the project dir (.amo-credentials / credential files,
# web-ext-artifacts/, test/, build.sh, .claude/, .git/, CHANGELOG.md, LICENSE,
# *.example.json, node_modules/, …) is excluded by simply never being listed.
# manifest.json must be at the archive root.
CONTENTS=(manifest.json matcher.js background.js options icons api README.md)

# Junk that must never ship even if it appears *inside* a shipped dir above
# (dotfiles, OS/editor cruft, and WSL "mark of the web" Zone.Identifier files).
# Applied both when linting and when zipping.
EXCLUDES=(
  '*/.*'                 # dotfiles in subdirectories (.DS_Store, .gitkeep, …)
  '.*'                   # dotfiles at the archive root
  'icons/icon.png'       # 1024px listing artwork; the add-on loads icons/icon.svg
  '*Zone.Identifier'     # WSL / NTFS alternate-data-stream artifacts
  '*~'                   # editor backups
  '*.bak'
  '*.orig'
  '*.swp'
  '.DS_Store'
  'Thumbs.db'
  '*/node_modules/*'
)

# Read the version from manifest.json for the default output name.
VERSION="$(node -p "require('./manifest.json').version" 2>/dev/null || echo "dev")"

# --- Parse args ------------------------------------------------------------
DO_DIST="no"
OUTPUT=""
for arg in "$@"; do
  case "$arg" in
    dist) DO_DIST="yes" ;;
    -*)   echo "Unknown option: $arg" >&2; exit 1 ;;
    *)    OUTPUT="$arg" ;;
  esac
done
OUTPUT="${OUTPUT:-web-ext-artifacts/attachment-guard-${VERSION}.xpi}"

# zip needs a path relative to cwd; resolve a relative OUTPUT against cwd.
case "$OUTPUT" in
  /*) OUT_ABS="$OUTPUT" ;;
  *)  OUT_ABS="$PWD/$OUTPUT" ;;
esac

# --- Validate + test -------------------------------------------------------
echo "Validating sources…"
for f in manifest.json api/FilterTerm/schema.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || { echo "Invalid JSON: $f" >&2; exit 1; }
done
for f in matcher.js background.js options/options.js api/FilterTerm/implementation.js; do
  node --check "$f" || { echo "Syntax error: $f" >&2; exit 1; }
done

echo "Running tests…"
node --test test/ >/dev/null || { echo "Tests failed (run: node --test test/)" >&2; exit 1; }

# --- Optional lint (dist) --------------------------------------------------
# Stage exactly what ships and lint that, so the linter sees the real package.
if [[ "$DO_DIST" == "yes" ]]; then
  echo "Staging package contents for lint…"
  STAGE="$(mktemp -d)"
  trap 'rm -rf "$STAGE"' EXIT
  for item in "${CONTENTS[@]}"; do
    [[ -e "$item" ]] || { echo "Missing content: $item" >&2; exit 1; }
    mkdir -p "$STAGE/$(dirname "$item")"
    cp -R "$item" "$STAGE/$(dirname "$item")/"
  done
  # Drop excluded junk from the staged copy.
  find "$STAGE" \( -name '.*' -o -name '*Zone.Identifier' -o -name '*~' \
    -o -name '*.bak' -o -name '*.orig' -o -name '*.swp' \
    -o -name 'Thumbs.db' -o -name 'node_modules' \) \
    -exec rm -rf {} + 2>/dev/null || true
  # Keep the staged tree in sync with EXCLUDES above.
  rm -f "$STAGE/icons/icon.png"

  echo "Linting (web-ext lint) — advisory, does not block the build…"
  if ! npx --yes web-ext lint --source-dir "$STAGE"; then
    echo "" >&2
    echo "Note: web-ext lint reported issues. It is AMO-oriented and may flag" >&2
    echo "Thunderbird-only APIs (experiment_apis, mail permissions) that" >&2
    echo "Thunderbird accepts. Review the output above; continuing with the build." >&2
  fi
fi

# --- Package ---------------------------------------------------------------
echo "Packaging $OUT_ABS …"
mkdir -p "$(dirname "$OUT_ABS")"
rm -f "$OUT_ABS"

# Build the -x exclude argument list for zip.
ZIP_EXCLUDES=()
for pat in "${EXCLUDES[@]}"; do
  ZIP_EXCLUDES+=(-x "$pat")
done
zip -r -FS "$OUT_ABS" "${CONTENTS[@]}" "${ZIP_EXCLUDES[@]}" >/dev/null

echo "Built $OUT_ABS"
unzip -l "$OUT_ABS"

if [[ "$DO_DIST" == "yes" ]]; then
  # --- Update manifest ------------------------------------------------------
  # updates.json is what installed copies poll (applications.gecko.update_url).
  # It is regenerated from manifest.json + the hash of the .xpi just built, so
  # the two can never drift — a stale update_hash makes Thunderbird silently
  # refuse the update. It is NOT part of CONTENTS and never ships inside the
  # .xpi. Commit and push it, and attach the .xpi to the matching GitHub
  # release, or the update_link 404s. See RELEASING.md.
  echo "Regenerating updates.json…"
  node - "$OUT_ABS" <<'NODE'
const fs = require("fs");
const crypto = require("crypto");
const m = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const gecko = m.applications.gecko;
const hash = crypto.createHash("sha256")
  .update(fs.readFileSync(process.argv[2]))
  .digest("hex");
const out = {
  addons: {
    [gecko.id]: {
      updates: [{
        version: m.version,
        update_link: `https://github.com/daviro-dev/attachment-guard/releases/download/v${m.version}/attachment-guard-${m.version}.xpi`,
        update_hash: `sha256:${hash}`,
        applications: {
          gecko: {
            strict_min_version: gecko.strict_min_version,
            strict_max_version: gecko.strict_max_version,
          },
        },
      }],
    },
  },
};
fs.writeFileSync("updates.json", JSON.stringify(out, null, 2) + "\n");
console.log(`  updates.json -> ${m.version}  sha256:${hash.slice(0, 12)}…`);
NODE

  cat <<EOF

Release package ready:
  $OUT_ABS

This add-on is self-distributed — publish the .xpi and tag the release. No
signing step is required; users install via Add-ons Manager > gear >
"Install Add-on From File…". See RELEASING.md.

Do not forget: commit the regenerated updates.json and push it to main, and
attach the .xpi above to the v${VERSION} GitHub release. Installed copies poll
updates.json; if its update_hash or update_link is wrong, updates fail silently.

Note: from Thunderbird 153 the Release channel disables Experiment APIs, so the
Message Filters condition and config override only work on ESR 153 (and
Betterbird). Core attachment screening is unaffected.
EOF
fi
