# Releasing Attachment Guard

This is a **Thunderbird** MailExtension, distributed through
**addons.thunderbird.net (ATN)** — a separate ecosystem from Firefox's
addons.mozilla.org (AMO).

## No API signing — upload by hand

Unlike Firefox/AMO, ATN does **not** cryptographically sign add-ons and does
**not** provide an upload API or JWT API keys. There is nothing to configure
locally and no `web-ext sign` step: you build the `.xpi` and upload it through
the ATN Developer Hub web form.

- Developer Hub: <https://addons.thunderbird.net/developers/>
- The add-on id (`attachment-guard@daviro.dev`) and `strict_min_version` come
  from `manifest.json`.

> This file replaces the old `.amo-credentials` — those were Firefox/AMO keys
> that do not apply to a Thunderbird-only extension.

## Cut a release

1. Bump `version` in `manifest.json` and update `CHANGELOG.md`.
2. Build a clean, review-ready package (runs tests + `web-ext lint`):

   ```bash
   ./build.sh dist
   ```

   The artifact lands in `web-ext-artifacts/attachment-guard-<version>.xpi`
   (same folder as a plain `./build.sh`).

   > `web-ext lint` is an AMO-oriented tool; it can flag Thunderbird-specific
   > APIs (`experiment_apis`, mail permissions) that ATN accepts. Its output is
   > advisory here and does not fail the build — read it, but ATN's own review
   > is the real gate.

3. Upload the `.xpi` at <https://addons.thunderbird.net/developers/> and fill in
   the version notes.

## Self-distribution (no store)

The same `.xpi` installs directly in Thunderbird (Add-ons Manager → gear →
*Install Add-on From File…*). For managed/pinned deployments you can set
`xpinstall.signatures.required = false`. No signing required either way.

## Just build (no lint / release ceremony)

```bash
./build.sh              # -> web-ext-artifacts/attachment-guard-<version>.xpi
./build.sh out.xpi      # -> ./out.xpi
```
