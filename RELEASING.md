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

## Cut a release

1. Bump `version` in `manifest.json` and update `CHANGELOG.md`.
2. Build (runs JSON/syntax validation + tests):

   ```bash
   ./build.sh              # -> web-ext-artifacts/attachment-guard-<version>.xpi
   ./build.sh out.xpi      # -> ./out.xpi
   ./build.sh dist         # also runs web-ext lint (advisory)
   ```

3. Publish the `.xpi` (GitHub release, or wherever you host it) and tag:

   ```bash
   git tag -a v<version> -m "Attachment Guard v<version>"
   ```

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
