/*
 * Attachment Guard - experiment API
 *
 * Registers a custom filter/search term, "expressionsearch-style", that lets a
 * Thunderbird Message Filter (Tools > Message Filters) or Search match against
 * the names/extensions of a message's attachments — something the built-in
 * conditions cannot do.
 *
 * The term streams each candidate message through the MIME parser and inspects
 * the `name=` (content-type) and `filename=` (content-disposition) parameters,
 * exactly like the reference implementation it is derived from.
 */

"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);
var { MimeParser } = ChromeUtils.importESModule(
  "resource:///modules/mimeParser.sys.mjs"
);
var { NetUtil } = ChromeUtils.importESModule(
  "resource://gre/modules/NetUtil.sys.mjs"
);
var { ExtensionSupport } = ChromeUtils.importESModule(
  "resource:///modules/ExtensionSupport.sys.mjs"
);

// The "#"-suffix is what appears in the raw msgFilterRules.dat condition, so
// keep it descriptive. It matches the attachment filename and/or extension.
const TERM_ID = "attachmentfilter#attachmentNameOrExtension";
const TERM_NAME = "Attachment name / extension";

/* ------------------------------------------------------------------ */
/* Matching helpers (self-contained: a registered custom term must not  */
/* depend on anything that can be unloaded with the add-on).            */
/* ------------------------------------------------------------------ */

// Kept identical to matcher.js. Supports * ? and [..] character classes,
// e.g. "*.r[0-9][0-9]".
const GLOB_LITERAL_SPECIALS = ".+^${}()|]\\";

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      re += ".*";
    } else if (c === "?") {
      re += ".";
    } else if (c === "[") {
      let j = i + 1;
      let cls = "";
      if (glob[j] === "!" || glob[j] === "^") { cls += "^"; j++; }
      let closed = false;
      for (; j < glob.length; j++) {
        if (glob[j] === "]") { closed = true; break; }
        if (glob[j] !== "\\") { cls += glob[j]; }
      }
      if (closed && cls.replace(/^\^/, "").length > 0) {
        re += "[" + cls + "]";
        i = j;
      } else {
        re += "\\[";
      }
    } else if (GLOB_LITERAL_SPECIALS.includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

// Mirrors the matching used by the background auto-filter, so the native
// filter condition behaves the same way the settings page does.
function fileMatchesPattern(fileName, pattern) {
  const name = (fileName || "").toLowerCase().trim();
  let pat = (pattern || "").toLowerCase().trim();
  if (!pat || !name) return false;
  if (pat.includes("*") || pat.includes("?") || pat.includes("[")) {
    return globToRegExp(pat).test(name);
  }
  if (pat.startsWith(".")) pat = pat.slice(1);
  if (!pat) return false;
  // Plain token => extension match (kept identical to matcher.js so the native
  // filter condition and the automatic filter behave the same way).
  return name.endsWith("." + pat);
}

// Pull every attachment filename / content-type name out of a raw message.
function collectAttachmentNames(aMsgHdr) {
  const names = [];
  let haveAttachment = false;
  const folder = aMsgHdr.folder;
  try {
    const offline = (aMsgHdr.flags & Ci.nsMsgMessageFlags.Offline) ||
      folder instanceof Ci.nsIMsgLocalMailFolder;
    if (!folder.getMsgInputStream || !offline) {
      return { names, haveAttachment };
    }
    const reusable = {};
    const stream = folder.getMsgInputStream(aMsgHdr, reusable);
    let data;
    try {
      data = NetUtil.readInputStreamToString(stream, aMsgHdr.messageSize);
    } finally {
      if (!reusable.value) stream.close();
    }
    if (typeof data === "undefined") return { names, haveAttachment };

    const emitter = {
      startPart(partNum, headers) {
        try {
          const contentType = headers.get("content-type");
          if (contentType && contentType.has && contentType.has("name")) {
            names.push(String(contentType.get("name")).toLowerCase());
            haveAttachment = true;
          }
          for (const disposition of (headers.get("content-disposition") || [])) {
            const d = MimeParser.parseHeaderField(
              disposition,
              MimeParser.HEADER_PARAMETER | MimeParser.HEADER_OPTION_ALL_I18N,
              ""
            );
            if (d && d.preSemi === "attachment") haveAttachment = true;
            if (d && d.has && d.has("filename")) {
              names.push(String(d.get("filename")).toLowerCase());
              haveAttachment = true;
            }
          }
        } catch (e) { Cu.reportError(e); }
      },
      deliverPartData() { /* body parts not needed */ },
      endPart() { }
    };
    MimeParser.parseSync(data, emitter, { bodyformat: "none" });
  } catch (e) {
    Cu.reportError(e);
  }
  return { names, haveAttachment };
}

/* ------------------------------------------------------------------ */
/* The custom term object                                              */
/* ------------------------------------------------------------------ */

const attachmentTerm = {
  id: TERM_ID,
  name: TERM_NAME,
  needsBody: true,

  getEnabled(scope, op) { return true; },
  getAvailable(scope, op) { return true; },
  getAvailableOperators(scope) {
    return [Ci.nsMsgSearchOp.Contains, Ci.nsMsgSearchOp.DoesntContain];
  },

  match(aMsgHdr, aSearchValue, aSearchOp) {
    const { names, haveAttachment } = collectAttachmentNames(aMsgHdr);
    let found = false;
    if (haveAttachment) {
      for (const n of names) {
        if (fileMatchesPattern(n, aSearchValue)) { found = true; break; }
      }
    }
    if (aSearchOp === Ci.nsMsgSearchOp.DoesntContain) return !found;
    return found;
  }
};

/* ------------------------------------------------------------------ */
/* Filter-editor value textbox fix                                      */
/*                                                                      */
/* Thunderbird renders the value field of a *custom* search term as an  */
/* empty <hbox class="search-value-custom"> (see the "FIXME: We need a   */
/* better way for extensions to set a custom input" in searchWidgets.js).*/
/* Core stores the typed value in that hbox's `value` attribute. We      */
/* inject a real <input> into the hbox and keep it synced both ways, so  */
/* the term becomes usable from the Filter Editor / Search dialogs       */
/* instead of requiring manual edits to msgFilterRules.dat.              */
/* ------------------------------------------------------------------ */

const WINDOW_LISTENER_ID = "attachment-filter-search-term-input";
const SEARCH_WINDOW_URLS = [
  "chrome://messenger/content/FilterEditor.xhtml",
  "chrome://messenger/content/SearchDialog.xhtml",
  "chrome://messenger/content/virtualFolderProperties.xhtml",
];
let windowListenerRegistered = false;

function injectCustomInput(hbox) {
  // Only touch the hbox belonging to our own term.
  if (hbox.getAttribute("searchAttribute") !== TERM_ID) return;

  const doc = hbox.ownerDocument;
  let input = hbox.querySelector("input.attachment-filter-value");
  if (!input) {
    input = doc.createElement("input");
    input.setAttribute("type", "text");
    input.className = "input-inline search-value-input attachment-filter-value";
    input.setAttribute("flex", "1");
    // Core reads/writes the value through the hbox's `value` attribute.
    const sync = () => hbox.setAttribute("value", input.value);
    input.addEventListener("input", sync);
    input.addEventListener("change", sync);
    hbox.appendChild(input);
  }
  // Reflect a value set by core (e.g. when editing a saved filter) into the
  // field, but never clobber what the user is currently typing.
  if (doc.activeElement !== input) {
    input.value = hbox.getAttribute("value") || "";
  }
}

function decorateSearchWindow(win) {
  try {
    const doc = win.document;
    const scan = () => {
      for (const hbox of doc.querySelectorAll("hbox.search-value-custom")) {
        injectCustomInput(hbox);
      }
    };
    const observer = new win.MutationObserver(scan);
    observer.observe(doc.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["searchAttribute", "value", "class"],
    });
    win.addEventListener("unload", () => observer.disconnect(), { once: true });
    scan();
  } catch (e) {
    Cu.reportError(e);
  }
}

function registerWindowListener() {
  if (windowListenerRegistered) return;
  ExtensionSupport.registerWindowListener(WINDOW_LISTENER_ID, {
    chromeURLs: SEARCH_WINDOW_URLS,
    onLoadWindow: decorateSearchWindow,
  });
  windowListenerRegistered = true;
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

var FilterTerm = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    return {
      FilterTerm: {
        async registerTerm() {
          try {
            if (!MailServices.filters.getCustomTerm(TERM_ID)) {
              MailServices.filters.addCustomTerm(attachmentTerm);
            }
            // Make the term's value field actually render in the filter/search
            // dialogs (works around the core "custom input" FIXME).
            registerWindowListener();
          } catch (e) {
            Cu.reportError(e);
            throw e;
          }
        }
      }
    };
  }

  onShutdown(isAppShutdown) {
    // There is no public API to remove a custom term; it disappears on the
    // next restart. Re-registration on startup is guarded by getCustomTerm.
    if (windowListenerRegistered && !isAppShutdown) {
      try {
        ExtensionSupport.unregisterWindowListener(WINDOW_LISTENER_ID);
      } catch (e) {
        Cu.reportError(e);
      }
      windowListenerRegistered = false;
    }
  }
};
