# Attachment Guard

A focused Thunderbird (128 ESR / 140+) MailExtension that handles incoming mail
based on **attachment file type**.

## What it does

1. **Automatic filtering of received mail on all accounts.**
   When a new message arrives, its attachments are inspected. If any attachment
   matches your block list, the message is either:
   - **moved** to a folder you choose (optionally marked read), or
   - **marked as read**, or
   - **deleted** (to Trash, or permanently), or
   - **marked & warned**: tagged with a red “⚠ Dangerous attachment” label in
     the message list, and a warning banner is shown at the top of the message
     when it is opened. The message is left in place (non-destructive).

2. **Native Message Filters condition.**
   It registers an **“Attachment name / extension”** condition into
   Thunderbird's *Tools → Message Filters* and Search dialogs, so you can build
   your own rules combining attachment type with sender/subject/etc. and use
   Thunderbird's full set of filter actions.

## Block-list rules

One rule per line on the settings page:

| Rule              | Matches                                             |
|-------------------|-----------------------------------------------------|
| `exe` / `.exe`    | any attachment whose **extension** is `.exe`        |
| `tar.gz`          | any attachment ending in `.tar.gz`                  |
| `*.tar.gz`        | same, as an explicit glob                           |
| `invoice*`        | filename starting with `invoice`                    |
| `*.p??`           | `.pdf`, `.png`, … (single-char `?` wildcards)       |
| `*.r[0-9][0-9]`   | split-RAR parts `.r00`–`.r99` (digits only)         |
| `*.[!a-z]z`       | `[set]`/`[range]`, `[!…]` negates (one character)   |

Matching is case-insensitive. Wildcards: `*` = any text, `?` = any single
character, `[…]` = one character from a set/range (`[0-9]`, `[a-f]`, `[abc]`),
and `[!…]` negates the set. **Reset to defaults** repopulates the block list
with the built-in dangerous-extension set (you still click Save to apply it).

## Other settings

- **Only match real attachments** (off by default): ignores inline parts such as
  embedded signature images, so adding image/document extensions won't trip on
  them. When off, every attachment part is considered (original behaviour).
- **Trusted senders**: addresses or domains (e.g. `@gmail.com`) that are
  never filtered, even if they carry a blocked attachment.
- **Notifications** are off by default.
- **Activity log** (off by default): when enabled, each filtered message is
  recorded (time, sender, subject, matched rule, action) and shown as a table on
  the settings page — handy for verifying behaviour while testing. Capped to the
  last 100 entries; **Clear log** empties it.

Turning off **Enable automatic filtering** only disables the background
all-accounts automation — any Thunderbird *Message Filter* you built with the
“Attachment name / extension” condition keeps working, because that term is
registered independently at startup.

## Development / tests

The filename-matching logic lives in `matcher.js` (a plain module shared by the
background script and the tests). Run the suite with:

```bash
node --test test/
```

`build.sh` runs these automatically and refuses to package if they fail.

## Files

```
manifest.json                  MV2 manifest
background.js                  new-mail listener + actions + manual scan
options/                       settings page (HTML/CSS/JS)
api/FilterTerm/                experiment API: registers the custom filter term
icons/icon.svg                 toolbar / add-on icon
build.sh                       validate sources + package into an .xpi
```

## Installing for development

1. Thunderbird → *Tools → Developer Tools → Debug Add-ons*
   (or *Add-ons Manager → gear → Debug Add-ons*).
2. **Load Temporary Add-on…** and select `manifest.json` in this folder.

> The native Message-Filters condition is provided by an **Experiment API**.
> Experiment APIs only run when the add-on is loaded temporarily (development)
> or installed from a self-distributed/privileged signed `.xpi` — they are not
> permitted in add-ons distributed through addons.thunderbird.net.

## Packaging

Run the build script — it validates the JSON/JS sources, then packages them
into an `.xpi` with `manifest.json` at the archive root:

```bash
./build.sh              # -> ../attachment-guard-<version>.xpi
./build.sh out.xpi      # -> ./out.xpi (custom output path)
```

The version in the default filename is read from `manifest.json`.

## Notes / limitations

- `onNewMailReceived` fires *after* Thunderbird's own message filters and junk
  classification, so your manual Message-Filters rules run first.
- A registered custom filter term cannot be removed at runtime by add-ons; it
  disappears on the next Thunderbird restart. After re-enabling the add-on
  without restarting, restart Thunderbird so the term is freshly registered.
- For IMAP, a message must be available offline for attachment parsing in the
  *native filter condition*; the automatic filter uses the WebExtension API and
  works regardless.
- **Custom-term value textbox:** Thunderbird/Betterbird render the value field
  of *any* custom search term as an empty `<hbox class="search-value-custom">`
  (there is a `// FIXME: We need a better way for extensions to set a custom
  input` in `searchWidgets.js`), so the box where you type the extension never
  appears — this affects every add-on that adds a custom term. `api/FilterTerm`
  works around it by injecting a real `<input>` into that hbox (synced to the
  hbox's `value` attribute, which is what core reads/writes) in the Filter
  Editor, Search Messages, and Virtual Folder Properties windows, via
  `ExtensionSupport.registerWindowListener`. No more hand-editing
  `msgFilterRules.dat`.

## License & credits

Released under the **Mozilla Public License 2.0** (see `LICENSE`).

The approach of adding a custom attachment condition to Thunderbird's native
Message Filters was inspired by **Expression Search / GMailUI - NG**
(Ken Mixter, Opera Wang, Klaus Buecher/opto). This is an independent
implementation — no source code from that project is used here.
