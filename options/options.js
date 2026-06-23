/*
 * Attachment Guard - options page
 */

const DEFAULT_SETTINGS = {
  enabled: true,
  monitorAllFolders: false,
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
  attachmentsOnly: false,
  exemptSenders: [],
  action: "move",
  destination: null,
  markReadOnMove: true,
  deletePermanently: false,
  notify: false,
  logActivity: false
};

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/* Folder enumeration                                                  */
/* ------------------------------------------------------------------ */

// Find the "Local Folders → Trash" folder (exists on most profiles) and return
// it as a destination spec, or null if it can't be found.
function findLocalFoldersTrash(accounts) {
  for (const account of accounts) {
    // The "Local Folders" account has type "none".
    if (account.type !== "none") continue;
    const root = account.rootFolder || { subFolders: account.folders || [] };
    const trash = (root.subFolders || []).find(
      f => f.type === "trash" || f.path === "/Trash"
    );
    if (trash) {
      return { accountId: trash.accountId, path: trash.path, name: trash.name };
    }
  }
  return null;
}

// Walk the folder tree of every account and return a flat, indented list.
function buildFolderList(accounts) {
  const out = [];

  const walk = (folder, accountName, depth) => {
    // Skip the synthetic root folder itself (no usable path beyond "/").
    if (folder.path && folder.path !== "/") {
      out.push({
        accountId: folder.accountId,
        path: folder.path,
        name: folder.name,
        label: `${accountName} · ${folder.path}`,
        depth
      });
    }
    for (const sub of (folder.subFolders || [])) {
      walk(sub, accountName, depth + 1);
    }
  };

  for (const account of accounts) {
    const root = account.rootFolder ||
      { subFolders: account.folders || [], path: "/", accountId: account.id };
    walk(root, account.name, 0);
  }
  return out;
}

function fillFolderSelect(select, folders, selectedSpec) {
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "— choose a folder —";
  select.appendChild(placeholder);

  for (const f of folders) {
    const opt = document.createElement("option");
    opt.value = JSON.stringify({ accountId: f.accountId, path: f.path, name: f.name });
    opt.textContent = " ".repeat(f.depth * 2) + f.label;
    if (selectedSpec &&
        selectedSpec.accountId === f.accountId &&
        selectedSpec.path === f.path) {
      opt.selected = true;
    }
    select.appendChild(opt);
  }
}

/* ------------------------------------------------------------------ */
/* Form <-> settings                                                   */
/* ------------------------------------------------------------------ */

function updateActionDetails() {
  const action = document.querySelector('input[name="action"]:checked')?.value;
  document.querySelectorAll(".action-detail").forEach(el => {
    el.classList.toggle("show", el.dataset.for === action);
  });
}

function applySettingsToForm(s) {
  $("enabled").checked = s.enabled;
  $("monitorAllFolders").checked = s.monitorAllFolders;
  $("patterns").value = (s.patterns || []).join("\n");
  $("attachmentsOnly").checked = s.attachmentsOnly;
  $("exemptSenders").value = (s.exemptSenders || []).join("\n");
  $("markReadOnMove").checked = s.markReadOnMove;
  $("deletePermanently").checked = s.deletePermanently;
  $("notify").checked = s.notify;
  $("logActivity").checked = s.logActivity;
  const radio = document.querySelector(`input[name="action"][value="${s.action}"]`);
  if (radio) radio.checked = true;
  updateActionDetails();
}

function readFormSettings() {
  const patterns = $("patterns").value
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  const exemptSenders = $("exemptSenders").value
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  let destination = null;
  const destVal = $("destination").value;
  if (destVal) {
    try { destination = JSON.parse(destVal); } catch (e) { destination = null; }
  }

  return {
    enabled: $("enabled").checked,
    monitorAllFolders: $("monitorAllFolders").checked,
    patterns,
    attachmentsOnly: $("attachmentsOnly").checked,
    exemptSenders,
    action: document.querySelector('input[name="action"]:checked')?.value || "move",
    destination,
    markReadOnMove: $("markReadOnMove").checked,
    deletePermanently: $("deletePermanently").checked,
    notify: $("notify").checked,
    logActivity: $("logActivity").checked
  };
}

function setStatus(el, message, kind) {
  el.textContent = message;
  el.className = "status" + (kind ? " " + kind : "");
}

/* ------------------------------------------------------------------ */
/* Activity log                                                        */
/* ------------------------------------------------------------------ */

function renderLog(entries) {
  const table = $("log-table");
  const body = $("log-body");
  const empty = $("log-empty");
  body.textContent = "";

  if (!entries || entries.length === 0) {
    table.hidden = true;
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  table.hidden = false;

  for (const e of entries) {
    const tr = document.createElement("tr");
    const when = e.time ? new Date(e.time).toLocaleString() : "";
    const cells = [
      { text: when, cls: "" },
      { text: e.author || "", cls: "sender" },
      { text: e.subject || "(no subject)", cls: "subject" },
      { text: `${e.fileName || ""} ~ ${e.pattern || ""}`, cls: "matched" },
      { text: e.action || "", cls: "action" }
    ];
    for (const c of cells) {
      const td = document.createElement("td");
      td.textContent = c.text;        // textContent => no HTML injection
      if (c.cls) td.className = c.cls;
      if (c.cls === "subject" || c.cls === "sender") td.title = c.text;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

async function refreshLog() {
  const stored = await messenger.storage.local.get("activityLog");
  renderLog(stored.activityLog || []);
}

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */

async function init() {
  const stored = await messenger.storage.local.get("settings");
  const settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };

  let folders = [];
  let accounts = [];
  try {
    accounts = await messenger.accounts.list();
    folders = buildFolderList(accounts);
  } catch (e) {
    console.error("Could not list folders:", e);
  }

  // No saved destination yet => pre-select Local Folders Trash if it exists.
  const selectedDest = settings.destination || findLocalFoldersTrash(accounts);

  fillFolderSelect($("destination"), folders, selectedDest);
  fillFolderSelect($("scan-folder"), folders, null);

  applySettingsToForm(settings);

  // If a deployed override file is forcing settings on this machine, show a
  // notice and reflect the effective (file-forced) values in the form.
  try {
    const info = await messenger.runtime.sendMessage({ command: "getOverrideInfo" });
    if (info && info.active) {
      if (info.settings) {
        applySettingsToForm({ ...settings, ...info.settings });
        fillFolderSelect($("destination"), folders, info.settings.destination || selectedDest);
      }
      $("managed-keys").textContent = info.keys.join(", ");
      if (info.path) $("managed-path").textContent = info.path;
      $("managed-notice").hidden = false;
    }
  } catch (e) {
    console.warn("Could not get override info:", e);
  }

  document.querySelectorAll('input[name="action"]').forEach(r =>
    r.addEventListener("change", updateActionDetails));

  $("reset-all").addEventListener("click", async () => {
    // Reset every setting to its default. The destination falls back to Local
    // Folders Trash (as on first run) rather than an empty selection.
    const defaults = { ...DEFAULT_SETTINGS, destination: findLocalFoldersTrash(accounts) };
    applySettingsToForm(defaults);
    fillFolderSelect($("destination"), folders, defaults.destination);
    await messenger.storage.local.set({ settings: defaults });
    setStatus($("reset-status"), "All settings reset to defaults and saved.", "ok");
    setTimeout(() => setStatus($("reset-status"), ""), 3000);
  });

  // Activity log: initial render, clear button, and live updates.
  await refreshLog();
  $("clear-log").addEventListener("click", async () => {
    await messenger.storage.local.set({ activityLog: [] });
    renderLog([]);
  });
  messenger.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.activityLog) {
      renderLog(changes.activityLog.newValue || []);
    }
  });

  $("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const next = readFormSettings();
    if (next.action === "move" && !next.destination) {
      setStatus($("save-status"), "Pick a destination folder for the Move action.", "err");
      return;
    }
    await messenger.storage.local.set({ settings: next });
    setStatus($("save-status"), "Saved.", "ok");
    setTimeout(() => setStatus($("save-status"), ""), 2500);
  });

  // Support modal
  const supportModal = $("support-modal");
  const openSupport = () => { supportModal.hidden = false; };
  const closeSupport = () => { supportModal.hidden = true; };
  $("help-fab").addEventListener("click", openSupport);
  $("support-close").addEventListener("click", closeSupport);
  supportModal.addEventListener("click", (e) => {
    if (e.target === supportModal) closeSupport();   // click backdrop to dismiss
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !supportModal.hidden) closeSupport();
  });

  $("scan-btn").addEventListener("click", async () => {
    const val = $("scan-folder").value;
    if (!val) {
      setStatus($("scan-status"), "Choose a folder to scan.", "err");
      return;
    }
    const folder = JSON.parse(val);
    setStatus($("scan-status"), "Scanning…");
    $("scan-btn").disabled = true;
    try {
      const result = await messenger.runtime.sendMessage({ command: "scanFolder", folder });
      setStatus($("scan-status"),
        `Done — scanned ${result.scanned}, acted on ${result.matched}.`, "ok");
    } catch (err) {
      setStatus($("scan-status"), "Scan failed: " + err.message, "err");
    } finally {
      $("scan-btn").disabled = false;
    }
  });
}

init();
