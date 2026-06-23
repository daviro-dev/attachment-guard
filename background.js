/*
 * Attachment Guard - background service
 *
 * Listens for newly received mail on all accounts, inspects each message's
 * attachments, and applies the configured action (move / mark read / delete)
 * when an attachment's filename matches one of the configured patterns.
 */

const DEFAULT_SETTINGS = {
  enabled: true,
  // false: only inbox + normal folders fire onNewMailReceived.
  // true:  also monitor special-use folders (archives, etc.).
  monitorAllFolders: false,
  // One pattern per entry. A bare token like "exe" or ".exe" matches by file
  // extension. A token containing * or ? is treated as a glob on the whole
  // filename (e.g. "invoice*", "*.tar.gz", "*.p??").
  patterns: [
    // Executables / installers
    "exe", "com", "scr", "pif", "cpl", "msi", "msp", "mst", "msc",
    "cmd", "bat", "hta", "ins", "isp", "nsh", "sct", "shb",
    // Scripts
    "js", "jse", "vb", "vbe", "vbs", "vxd", "wsc", "wsf", "wsh",
    // Java / shortcuts / misc system
    "jar", "lnk", "inetloc", "diagcab", "chm", "sys", "lib",
    "ade", "adp", "mde",
    // Office documents with macros / data-pull
    "docm", "xlsm", "pptm", "ppam", "xla", "iqy", "one", "rtf",
    // Archives & disk images
    "iso", "img", "cab", "ace", "arj", "r0", "tar", "gz"
  ],
  // Only match real attachments, ignoring inline parts (e.g. embedded
  // signature images). Off by default => current behaviour (match all parts).
  attachmentsOnly: false,
  // Senders/domains that are never filtered, e.g. "@gmail.com" or a full
  // address. Matched as a case-insensitive substring of the message author.
  exemptSenders: [],
  // "move" | "markRead" | "delete" | "markWarn"
  action: "move",
  // Destination for "move": { accountId, path, name } or null.
  destination: null,
  // When moving, also mark the message as read.
  markReadOnMove: true,
  // When deleting, skip Trash and delete permanently (TB 137+; falls back).
  deletePermanently: false,
  // Show a desktop notification each time a message is filtered.
  notify: false,
  // Record each filtered message to an activity log shown on the settings page.
  logActivity: false
};

// Recent filtered messages (newest first), mirrored to storage.local under
// "activityLog". Capped to keep storage small.
const MAX_LOG_ENTRIES = 100;
let activityLog = [];

let settings = { ...DEFAULT_SETTINGS };
let mailListener = null;

// Tag used by the "Mark & warn" action to flag a message in the list and to
// drive the on-open warning banner.
const DANGER_TAG_KEY = "attachment_filter_danger";
const DANGER_TAG_NAME = "⚠ Dangerous attachment";
const DANGER_TAG_COLOR = "#c0392b";

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

// Find the "Local Folders → Trash" folder, which exists on most profiles, and
// return it as a move destination spec. Returns null if it can't be found.
async function findLocalFoldersTrash() {
  try {
    const accounts = await messenger.accounts.list();
    for (const account of accounts) {
      // The "Local Folders" account has type "none".
      if (account.type !== "none") continue;
      const root = account.rootFolder ||
        { subFolders: account.folders || [] };
      const trash = (root.subFolders || []).find(
        f => f.type === "trash" || f.path === "/Trash"
      );
      if (trash) {
        return { accountId: trash.accountId, path: trash.path, name: trash.name };
      }
    }
  } catch (e) {
    console.warn("[Attachment Guard] Could not resolve Local Folders Trash:", e);
  }
  return null;
}

async function loadActivityLog() {
  const stored = await messenger.storage.local.get("activityLog");
  activityLog = Array.isArray(stored.activityLog) ? stored.activityLog : [];
}

// Append an entry to the activity log (only when logging is enabled).
async function recordActivity(entry) {
  if (!settings.logActivity) return;
  activityLog.unshift(entry);
  if (activityLog.length > MAX_LOG_ENTRIES) {
    activityLog.length = MAX_LOG_ENTRIES;
  }
  await messenger.storage.local.set({ activityLog });
}

async function loadSettings() {
  const stored = await messenger.storage.local.get("settings");
  settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  // When no destination has been chosen yet, default to Local Folders Trash
  // (falling back to null if that folder does not exist).
  if (settings.destination == null) {
    settings.destination = await findLocalFoldersTrash();
  }
  return settings;
}

/* ------------------------------------------------------------------ */
/* Pattern matching: globToRegExp / fileMatchesPattern / findMatch are  */
/* provided by matcher.js (loaded first via background.scripts).        */
/* ------------------------------------------------------------------ */

// True if a message's sender is on the trusted (never-filter) list.
function isExemptSender(message) {
  const list = settings.exemptSenders || [];
  if (list.length === 0) return false;
  const author = (message.author || "").toLowerCase();
  return list.some(entry => {
    const e = entry.toLowerCase().trim();
    return e && author.includes(e);
  });
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

async function getAttachmentNames(messageId) {
  let attachments;
  try {
    attachments = await messenger.messages.listAttachments(messageId);
  } catch (e) {
    // Some messages (e.g. not yet downloaded) can't be parsed; skip quietly.
    return [];
  }
  return (attachments || [])
    .filter(a => {
      // When enabled, ignore inline parts. contentDisposition is available on
      // newer Thunderbird/Betterbird; if it's missing we can't tell, so keep
      // the part rather than risk missing a real attachment.
      if (settings.attachmentsOnly && a.contentDisposition) {
        return a.contentDisposition === "attachment";
      }
      return true;
    })
    .map(a => a.name || "")
    .filter(Boolean);
}

// Ensure the "dangerous attachment" tag exists in Thunderbird's tag list.
async function ensureDangerTag() {
  try {
    const tags = await messenger.messages.tags.list();
    if (!tags.some(t => t.key === DANGER_TAG_KEY)) {
      await messenger.messages.tags.create(DANGER_TAG_KEY, DANGER_TAG_NAME, DANGER_TAG_COLOR);
    }
  } catch (e) {
    console.warn("[Attachment Guard] Could not create danger tag:", e);
  }
}

async function applyAction(message, match) {
  const id = message.id;
  switch (settings.action) {
    case "delete":
      if (settings.deletePermanently) {
        // deletePermanently option added in TB 137; older builds took a
        // boolean "skipTrash" as the second argument.
        try {
          await messenger.messages.delete([id], { deletePermanently: true });
        } catch (e) {
          await messenger.messages.delete([id], true);
        }
      } else {
        // No second argument => move to Trash on every supported version.
        // (Never pass an object here: on TB 128-136 it is read as a truthy
        // boolean and would permanently delete.)
        await messenger.messages.delete([id]);
      }
      return "deleted";

    case "markRead":
      await messenger.messages.update(id, { read: true });
      return "marked read";

    case "markWarn": {
      // Leave the message in place; just add the danger tag. The on-open
      // banner (see onMessageDisplayed) is driven by this tag.
      const tags = Array.from(new Set([...(message.tags || []), DANGER_TAG_KEY]));
      await messenger.messages.update(id, { tags });
      return "tagged";
    }

    case "move":
    default:
      if (!settings.destination) {
        console.warn("[Attachment Guard] No destination folder configured; skipping move.");
        return null;
      }
      if (settings.markReadOnMove) {
        try { await messenger.messages.update(id, { read: true }); } catch (e) { /* non-fatal */ }
      }
      await messenger.messages.move([id], settings.destination);
      return "moved";
  }
}

async function notifyFiltered(message, match, outcome) {
  if (!settings.notify || !outcome) return;
  try {
    await messenger.notifications.create({
      type: "basic",
      iconUrl: messenger.runtime.getURL("icons/icon.svg"),
      title: `Attachment filtered (${outcome})`,
      message: `"${message.subject || "(no subject)"}" — matched ${match.pattern} (${match.fileName})`
    });
  } catch (e) { /* notifications are best-effort */ }
}

// Inspect one message and act on it. Returns the outcome string or null.
async function processMessage(message) {
  if (!settings.patterns || settings.patterns.length === 0) return null;
  if (isExemptSender(message)) return null;
  const names = await getAttachmentNames(message.id);
  if (names.length === 0) return null;

  const match = findMatch(names, settings.patterns);
  if (!match) return null;

  let outcome = null;
  try {
    outcome = await applyAction(message, match);
  } catch (e) {
    console.error("[Attachment Guard] Failed to apply action:", e);
    return null;
  }
  if (outcome) {
    console.info(`[Attachment Guard] ${outcome}: "${message.subject}" (${match.fileName} ~ ${match.pattern})`);
    await notifyFiltered(message, match, outcome);
    await recordActivity({
      time: Date.now(),
      subject: message.subject || "",
      author: message.author || "",
      fileName: match.fileName,
      pattern: match.pattern,
      action: outcome
    });
  }
  return outcome;
}

/* ------------------------------------------------------------------ */
/* New-mail listener                                                   */
/* ------------------------------------------------------------------ */

async function onNewMail(folder, messageList) {
  if (!settings.enabled) return;
  let list = messageList;
  while (list) {
    for (const message of list.messages) {
      await processMessage(message);
    }
    list = list.id ? await messenger.messages.continueList(list.id) : null;
  }
}

function registerMailListener() {
  if (mailListener) {
    messenger.messages.onNewMailReceived.removeListener(mailListener);
    mailListener = null;
  }
  mailListener = onNewMail;
  // Second arg (monitorAllFolders) added in TB 121.
  messenger.messages.onNewMailReceived.addListener(mailListener, settings.monitorAllFolders);
}

/* ------------------------------------------------------------------ */
/* Manual scan (triggered from the options page)                       */
/* ------------------------------------------------------------------ */

async function scanFolder(folderSpec) {
  const result = { scanned: 0, matched: 0 };
  let page = await messenger.messages.list(folderSpec);
  while (page) {
    for (const message of page.messages) {
      result.scanned++;
      const outcome = await processMessage(message);
      if (outcome) result.matched++;
    }
    page = page.id ? await messenger.messages.continueList(page.id) : null;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Warning banner shown when a flagged message is opened               */
/* ------------------------------------------------------------------ */

const BANNER_CSS = `
#attachment-filter-warning {
  all: revert;
  display: block;
  position: sticky;
  top: 0;
  z-index: 2147483647;
  box-sizing: border-box;
  margin: 0 0 10px 0;
  padding: 10px 14px;
  background: #fdecea;
  color: #611a15;
  border: 1px solid #f5c6cb;
  border-left: 4px solid #c0392b;
  border-radius: 4px;
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  font-weight: 600;
}
`;

function buildBannerScript(text) {
  return `
(function () {
  try {
    var prev = document.getElementById("attachment-filter-warning");
    if (prev) prev.remove();
    var bar = document.createElement("div");
    bar.id = "attachment-filter-warning";
    bar.textContent = ${JSON.stringify(text)};
    if (document.body) {
      document.body.insertBefore(bar, document.body.firstChild);
    }
  } catch (e) { /* best-effort */ }
})();
`;
}

async function onMessageDisplayed(tab, message) {
  try {
    if (!message || !(message.tags || []).includes(DANGER_TAG_KEY)) return;

    // Name the offending attachment(s) for the banner text.
    const names = await getAttachmentNames(message.id);
    const match = findMatch(names, settings.patterns);
    const offending = match ? match.fileName : (names[0] || "an attachment");
    const text = `⚠ Potentially dangerous attachment: ${offending}. ` +
      `Do not open or run it unless you completely trust the sender.`;

    // Best-effort injection; the list tag is the reliable signal.
    await messenger.tabs.insertCSS(tab.id, { code: BANNER_CSS });
    await messenger.tabs.executeScript(tab.id, { code: buildBannerScript(text) });
  } catch (e) {
    console.warn("[Attachment Guard] Could not show warning banner:", e);
  }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

messenger.runtime.onMessage.addListener((msg) => {
  if (msg && msg.command === "scanFolder" && msg.folder) {
    return scanFolder(msg.folder);
  }
  return false;
});

messenger.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes.settings) {
    const prevMonitorAll = settings.monitorAllFolders;
    await loadSettings();
    if (settings.monitorAllFolders !== prevMonitorAll) {
      registerMailListener();
    }
  }
  // Keep the in-memory log in sync with external changes (e.g. the options
  // page clearing it), so we don't resurrect cleared entries on the next write.
  if (changes.activityLog) {
    activityLog = Array.isArray(changes.activityLog.newValue)
      ? changes.activityLog.newValue
      : [];
  }
});

messenger.browserAction.onClicked.addListener(() => {
  messenger.runtime.openOptionsPage();
});

// Warn whenever a tagged-dangerous message is opened, regardless of the
// currently selected action (the tag persists once applied).
messenger.messageDisplay.onMessageDisplayed.addListener(onMessageDisplayed);

async function init() {
  await loadSettings();
  await loadActivityLog();
  await ensureDangerTag();

  // Register the native Message Filters custom term via the experiment API.
  try {
    await messenger.FilterTerm.registerTerm();
  } catch (e) {
    console.warn("[Attachment Guard] Could not register custom filter term:", e);
  }

  registerMailListener();
}

init();
