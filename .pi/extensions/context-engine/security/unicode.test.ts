import { test } from "node:test";
import assert from "node:assert/strict";
import { scanUnicode } from "./unicode.ts";

test("zero-width space is detected with line and column", () => {
  const f = scanUnicode("a\u200bb");
  assert.equal(f.length, 1);
  assert.equal(f[0].id, "uni-zerowidth");
  assert.equal(f[0].severity, "low");
  assert.equal(f[0].line, 1);
  assert.equal(f[0].column, 2);
});

test("BOM at file start is not flagged", () => {
  assert.deepEqual(scanUnicode("\uFEFF# doc"), []);
});

test("tag characters (U+E0000-E007F) are detected", () => {
  const f = scanUnicode("a\u{E0001}b");
  assert.equal(f.length, 1);
  assert.equal(f[0].id, "uni-zerowidth");
});

test("BIDI controls are detected at high severity", () => {
  const f = scanUnicode("x\u202Ey");
  assert.equal(f[0].id, "uni-bidi");
  assert.equal(f[0].severity, "high");
  assert.equal(f[0].confidence, "high");
  assert.equal(scanUnicode("x\u2066y").length, 1); // bidi isolate
});

test("ESC control is high, other suspicious controls are medium", () => {
  const esc = scanUnicode("a\u001b[31m");
  assert.equal(esc[0].id, "uni-ctrl");
  assert.equal(esc[0].severity, "high");
  const nul = scanUnicode("a\u0000b");
  assert.equal(nul[0].severity, "medium");
});

test("tab/newline/CR are not flagged as controls", () => {
  assert.deepEqual(scanUnicode("a\tb\nc\rd"), []);
});

test("cyrillic homoglyph inside an ASCII word is medium", () => {
  const f = scanUnicode("d\u0430ngerous");
  assert.equal(f.length, 1);
  assert.equal(f[0].id, "uni-homoglyph");
  assert.equal(f[0].severity, "medium");
  assert.equal(f[0].column, 2);
});

test("greek omicron homoglyph is detected", () => {
  const f = scanUnicode("n\u03bftice");
  assert.equal(f[0].id, "uni-homoglyph");
});

test("roman numeral small ell homoglyph is detected", () => {
  const f = scanUnicode("fi\u217ce");
  assert.equal(f[0].id, "uni-homoglyph");
});

test("pure non-ASCII words are not homoglyph-flagged", () => {
  assert.deepEqual(scanUnicode("\u043f\u0440\u0438\u0432\u0435\u0442"), []);
});

test("NFD text is flagged, NFC text is not", () => {
  assert.equal(
    scanUnicode("cafe\u0301").some((f) => f.id === "uni-normalization"),
    true,
  );
  assert.equal(
    scanUnicode("caf\u00e9").some((f) => f.id === "uni-normalization"),
    false,
  );
});

test("positions track across lines", () => {
  const f = scanUnicode("ok\nfine\u200b");
  assert.equal(f[0].line, 2);
  assert.equal(f[0].column, 5);
});
