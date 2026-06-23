"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { fileMatchesPattern, findMatch, globToRegExp } =
  require("../matcher.js");

test("bare token matches by extension", () => {
  assert.ok(fileMatchesPattern("invoice.exe", "exe"));
  assert.ok(fileMatchesPattern("invoice.EXE", "exe"));     // case-insensitive
  assert.ok(fileMatchesPattern("invoice.exe", ".exe"));    // leading dot allowed
  assert.ok(!fileMatchesPattern("report.pdf", "exe"));
});

test("extension match is anchored to the end, not a substring", () => {
  assert.ok(!fileMatchesPattern("execute.txt", "exe"));    // "exe" not the ext
  assert.ok(!fileMatchesPattern("my.exe.notes", "exe"));   // ext is .notes
});

test("double extension (the classic disguise) is caught", () => {
  assert.ok(fileMatchesPattern("invoice.pdf.exe", "exe"));
  assert.ok(!fileMatchesPattern("invoice.pdf.exe", "pdf")); // only true ext matches
});

test("multi-dot extension token", () => {
  assert.ok(fileMatchesPattern("backup.tar.gz", "tar.gz")); // multi-dot token
  assert.ok(fileMatchesPattern("backup.tar.gz", "gz"));     // single ext also matches
  assert.ok(!fileMatchesPattern("backup.tar.gz", "tar"));   // "tar" is not the ext
});

test("glob patterns with * and ?", () => {
  assert.ok(fileMatchesPattern("invoice_2026.docm", "invoice*"));
  assert.ok(fileMatchesPattern("backup.tar.gz", "*.tar.gz"));
  assert.ok(fileMatchesPattern("photo.pdf", "*.p??"));
  assert.ok(fileMatchesPattern("photo.png", "*.p??"));
  assert.ok(!fileMatchesPattern("photo.jpeg", "*.p??"));   // 4-char ext
});

test("character-class digit ranges match only digits", () => {
  // The split-RAR case: .r00 .. .r99 but not .rar / .raa.
  assert.ok(fileMatchesPattern("archive.r00", "*.r[0-9][0-9]"));
  assert.ok(fileMatchesPattern("archive.r42", "*.r[0-9][0-9]"));
  assert.ok(!fileMatchesPattern("archive.rar", "*.r[0-9][0-9]")); // letters excluded
  assert.ok(!fileMatchesPattern("archive.r0", "*.r[0-9][0-9]"));  // needs two digits
});

test("character classes work without other wildcards", () => {
  // "[" alone is enough to trigger glob mode (anchored full-name match).
  assert.ok(fileMatchesPattern("file1.exe", "file[0-9].exe"));
  assert.ok(!fileMatchesPattern("filex.exe", "file[0-9].exe"));
});

test("letter ranges and negation", () => {
  assert.ok(fileMatchesPattern("photo.jpg", "*.[a-z][a-z][a-z]"));
  assert.ok(fileMatchesPattern("doc.7z", "*.[!a-z]z")); // first char not a letter
  assert.ok(!fileMatchesPattern("doc.az", "*.[!a-z]z"));
});

test("empty / whitespace inputs never match", () => {
  assert.ok(!fileMatchesPattern("", "exe"));
  assert.ok(!fileMatchesPattern("file.exe", ""));
  assert.ok(!fileMatchesPattern("file.exe", "   "));
});

test("globToRegExp escapes regex metacharacters", () => {
  // The dot in the pattern must be literal, not "any char".
  assert.ok(!globToRegExp("*.exe").test("axxexe"));
  assert.ok(globToRegExp("*.exe").test("a.exe"));
});

test("findMatch returns the first matching file/pattern pair", () => {
  const m = findMatch(["readme.txt", "payload.scr"], ["exe", "scr"]);
  assert.deepStrictEqual(m, { fileName: "payload.scr", pattern: "scr" });

  assert.strictEqual(findMatch(["readme.txt"], ["exe", "scr"]), null);
});
