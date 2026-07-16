# Changelog

All notable changes to **Attachment Guard** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.6] - 2026-07-16

### Changed
- Declared `strict_max_version` `152.*` in the manifest. Thunderbird's add-on
  site (ATN) requires a max version for add-ons that ship a Mail Experiment
  (this add-on's `FilterTerm` experiment API); supported range is now
  Thunderbird 128–152.

## [1.0.5] - 2026-06-23

### Added
- **Deployed settings override** for fleet/domain management. Drop an
  `attachment-guard.config.json` file in a profile to force settings on that
  machine; it takes precedence over the user's saved settings
  (file > stored settings > built-in defaults). Only the keys present in the
  file are forced — the rest stay user-editable.
  - File format is **JSONC**: standard JSON plus `//` / `/* */` comments and
    trailing commas, so it stays human-editable.
  - Picked up **live** (re-read when the file's modification time changes — no
    restart needed), except `monitorAllFolders`, whose re-subscription applies
    on the next received message or at startup.
  - The **move destination** accepts a human-friendly reference resolved per
    machine (the internal `accountId` differs across profiles):
    `"Local Folders/Quarantine"`, or `{ "account": "user@work.com", "path":
    "/Quarantine" }` — matched by `Local Folders`, account name, account id, or
    identity email. The raw `{ accountId, path }` form still works.
  - The settings page shows a **"managed settings" notice** listing the forced
    keys and the file path when an override is active.
- `attachment-guard.config.example.json` — a documented template covering every
  key.
- Experiment API methods `FilterTerm.getConfigOverride()` and
  `FilterTerm.getConfigPath()`.

### Changed
- Gecko add-on id aligned to `attachment-guard@daviro.dev` (was
  `attachment-filter@daviro.dev`).

## [1.0.4] - 2026-06-23

First public release on GitHub, rebranded from "Attachment Filter" to
**Attachment Guard**.

### Added
- Automatic, all-accounts filtering of newly received mail by attachment file
  type, with four actions: **move** to a folder (optionally mark read),
  **mark as read**, **mark & warn** (red tag + warning banner when opened,
  non-destructive), or **delete** (to Trash, or permanently).
- Block list matching by **extension** or **filename wildcards** — `*`, `?`,
  and `[…]` character classes/ranges (e.g. `*.tar.gz`, `invoice*`,
  `*.r[0-9][0-9]`). Case-insensitive, anchored to the real extension to catch
  double-extension disguises.
- **"Attachment name / extension"** custom condition for Thunderbird's native
  *Message Filters* and Search dialogs (experiment API), including a workaround
  that makes the custom-term value textbox actually render.
- **Trusted senders** exemptions (address or domain).
- **Only match real attachments** option (ignore inline parts such as signature
  images).
- **Manual folder scan** to apply rules to an existing backlog.
- Optional **activity log** (off by default) shown on the settings page.
- Optional desktop **notifications** (off by default).
- **Support / about** dialog (Buy Me a Coffee link + QR, GitHub repo link) and a
  **reset-to-defaults** action.
- Released under the **Mozilla Public License 2.0**.

[1.0.6]: https://github.com/daviro-dev/attachment-guard/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/daviro-dev/attachment-guard/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/daviro-dev/attachment-guard/releases/tag/v1.0.4
