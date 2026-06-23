#!/usr/bin/env bash
#
# Build attachment-guard.xpi from the source files in this directory.
#
# Usage:
#   ./build.sh            # -> ../attachment-guard-<version>.xpi
#   ./build.sh out.xpi    # -> ./out.xpi
#
set -euo pipefail

cd "$(dirname "$0")"

# Files/dirs that make up the add-on (manifest.json must be at the archive root).
CONTENTS=(manifest.json matcher.js background.js options icons api README.md)

# Read the version from manifest.json for the default output name.
VERSION="$(node -p "require('./manifest.json').version" 2>/dev/null || echo "dev")"
OUTPUT="${1:-../attachment-guard-${VERSION}.xpi}"

# zip needs a path relative to cwd; resolve a relative OUTPUT against cwd.
case "$OUTPUT" in
  /*) OUT_ABS="$OUTPUT" ;;
  *)  OUT_ABS="$PWD/$OUTPUT" ;;
esac

echo "Validating sources…"
for f in manifest.json api/FilterTerm/schema.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || { echo "Invalid JSON: $f" >&2; exit 1; }
done
for f in matcher.js background.js options/options.js api/FilterTerm/implementation.js; do
  node --check "$f" || { echo "Syntax error: $f" >&2; exit 1; }
done

echo "Running tests…"
node --test test/ >/dev/null || { echo "Tests failed (run: node --test test/)" >&2; exit 1; }

echo "Packaging $OUT_ABS …"
rm -f "$OUT_ABS"
zip -r -FS "$OUT_ABS" "${CONTENTS[@]}" -x '*/.*' >/dev/null

echo "Built $OUT_ABS"
unzip -l "$OUT_ABS"
