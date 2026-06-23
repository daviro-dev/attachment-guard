/*
 * Attachment Guard - filename matching (shared, pure, testable)
 *
 * Loaded as the first background script (so these become globals for
 * background.js) and also require()-able from the Node test suite.
 *
 * A bare token like "exe" or ".exe" matches by file extension. A token
 * containing *, ? or [ ] is treated as a glob over the whole filename:
 *   *           any run of characters
 *   ?           any single character
 *   [0-9]       one character from a set/range, e.g. [0-9], [a-f], [abc]
 *   [!0-9]      one character NOT in the set
 * e.g. "invoice*", "*.tar.gz", "*.p??", "*.r[0-9][0-9]".
 * Matching is case-insensitive.
 */

"use strict";

// Regex-special characters that must be escaped when copied literally
// (outside a character class). "[" is handled separately.
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
      // Character class: copy through to the closing "]".
      let j = i + 1;
      let cls = "";
      if (glob[j] === "!" || glob[j] === "^") { cls += "^"; j++; }
      let closed = false;
      for (; j < glob.length; j++) {
        if (glob[j] === "]") { closed = true; break; }
        if (glob[j] !== "\\") { cls += glob[j]; } // drop backslashes
      }
      if (closed && cls.replace(/^\^/, "").length > 0) {
        re += "[" + cls + "]";
        i = j; // advance past the "]"
      } else {
        re += "\\["; // unterminated/empty => treat "[" literally
      }
    } else if (GLOB_LITERAL_SPECIALS.includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

// True if a single filename matches a single pattern.
function fileMatchesPattern(fileName, pattern) {
  const name = (fileName || "").toLowerCase().trim();
  let pat = (pattern || "").toLowerCase().trim();
  if (!pat || !name) return false;

  if (pat.includes("*") || pat.includes("?") || pat.includes("[")) {
    return globToRegExp(pat).test(name);
  }

  // Plain token => extension match. Allow a leading dot and multi-dot ext.
  if (pat.startsWith(".")) pat = pat.slice(1);
  if (!pat) return false;
  return name.endsWith("." + pat);
}

// Returns the first { fileName, pattern } match, or null.
function findMatch(fileNames, patterns) {
  for (const name of fileNames) {
    for (const pat of patterns) {
      if (fileMatchesPattern(name, pat)) {
        return { fileName: name, pattern: pat };
      }
    }
  }
  return null;
}

// Exported for the Node test suite; ignored in the extension (no `module`).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { globToRegExp, fileMatchesPattern, findMatch };
}
