# Releasing Attachment Guard

This is a **Thunderbird** MailExtension, **self-distributed** — it is not hosted
on addons.thunderbird.net (ATN).

## Why not ATN

ATN rejected the submission (2026-07-16). ATN is not accepting new submissions
that use Experiment APIs, except unmodified copies of the published drafts in
<https://github.com/thunderbird/webext-experiments> (at the time of writing, only
`calendar` and `NotificationBox`). This add-on's `FilterTerm` experiment is not
among them, and no published draft registers a custom filter term — so there is
nothing to swap it for.

`FilterTerm` backs one feature with no WebExtension equivalent: the **"Attachment
name / extension" condition** in Thunderbird's native Message Filters and Search
dialogs. Keeping that feature means self-distributing. (Its other two methods,
`getConfigOverride` / `getConfigPath`, could be replaced by `storage.managed` —
supported since TB 57 — if the experiment is ever dropped.)

## Channel support — important

Thunderbird **disables Experiment APIs on the monthly Release channel starting
with version 153**; **ESR 153 keeps them**. From 153 onward this add-on is
effectively **ESR-only** (Betterbird also continues to support experiments).

On Release-channel 153+, the experiment calls in `background.js` are wrapped in
try/catch and fail soft: attachment screening still works, while the Message
Filters condition and the deployed-settings override are silently unavailable.

`strict_max_version` is `153.*`. It was originally `152.*` only because ATN
requires a max version for Mail Experiments; that requirement no longer applies,
but the cap is kept deliberately — raise it once a newer ESR is known good.

## Auto-updates

Self-distributed add-ons do not update themselves for free. `manifest.json` sets

```
applications.gecko.update_url =
  https://raw.githubusercontent.com/daviro-dev/attachment-guard/main/updates.json
```

Installed copies poll that URL and compare the advertised `version` against
their own. `updates.json` lives at the repo root, is served straight off `main`,
and is **not** part of the packaged `.xpi`.

Three things must agree or updates fail **silently** — no error, users simply
never see them:

1. `version` in `updates.json` == `version` in the shipped `manifest.json`
2. `update_hash` == sha256 of the exact published `.xpi`
3. `update_link` resolves — i.e. the `.xpi` is actually attached to the GitHub
   release for that tag, under exactly that filename

`./build.sh dist` regenerates `updates.json` from `manifest.json` plus the hash
of the `.xpi` it just built, so (1) and (2) cannot drift. **(3) is on you**: the
link 404s until you attach the `.xpi` to the release.

> Because `update_url` is read from the *installed* copy, auto-updates only work
> for users who installed a build that already had it (1.0.7 and later). Anyone
> on an earlier build must reinstall by hand once.

## Cut a release

1. Bump `version` in `manifest.json` and update `CHANGELOG.md`.
2. Build (runs JSON/syntax validation + tests; `dist` also regenerates
   `updates.json` and runs `web-ext lint`):

   ```bash
   ./build.sh dist         # release build -- use this one
   ./build.sh              # plain build, does NOT touch updates.json
   ./build.sh out.xpi      # -> ./out.xpi
   ```

3. Commit the version bump **and the regenerated `updates.json`**, then tag:

   ```bash
   git add manifest.json CHANGELOG.md updates.json
   git commit -m "Release v<version>: …"
   git tag -a v<version> -m "Attachment Guard v<version>"
   git push origin main --follow-tags
   ```

4. Create the GitHub release for `v<version>` and **attach
   `web-ext-artifacts/attachment-guard-<version>.xpi`**. The filename must match
   `update_link` in `updates.json`.

   ```bash
   gh release create v<version> \
     web-ext-artifacts/attachment-guard-<version>.xpi \
     --title "Attachment Guard v<version>" --notes-file <notes>
   ```

   Or via the web form: <https://github.com/daviro-dev/attachment-guard/releases/new>

5. Sanity-check the update path — `updates.json` on `main` should point at a URL
   that actually downloads:

   ```bash
   curl -sfI "$(node -p "require('./updates.json').addons['attachment-guard@daviro.dev'].updates[0].update_link")" -o /dev/null && echo OK
   ```

   (`raw.githubusercontent.com` caches for ~5 minutes, so a fresh push may take a
   moment to be visible to clients.)

> `web-ext lint` is AMO-oriented and flags Thunderbird-specific APIs
> (`experiment_apis`, mail permissions). Its output is advisory and does not fail
> the build.

## Installing a self-distributed build

Add-ons Manager → gear → *Install Add-on From File…*, then pick the `.xpi`.

Thunderbird does **not** require signing for this (unlike Firefox/AMO: there is
no `web-ext sign` step and no API keys). For managed/pinned deployments you can
set `xpinstall.signatures.required = false`.

> The old `.amo-credentials` file was Firefox/AMO keys that never applied to a
> Thunderbird-only extension.

## If ATN ever becomes an option

The experiment is not the add-on's main logic — all screening is plain
WebExtension code — so an ATN-eligible build would mean dropping `api/` and the
`experiment_apis` manifest block, porting the config override to
`storage.managed`, and losing the Message Filters condition.
