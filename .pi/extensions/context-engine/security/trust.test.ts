import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTrust, approve, revoke, status, currentHash, isCurrent } from "./trust.ts";

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nma-trust-")), "nma-trust.json");
}

test("loadTrust: missing file -> empty map, no throw", () => {
  const store = loadTrust(tmpFile());
  assert.equal(store.size, 0);
});

test("approve writes JSON with mode 0o600 and canonical path keys", (t) => {
  const file = tmpFile();
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  loadTrust(file);
  approve("relative/rule.md", "content", "medium", "user");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const key = path.resolve("relative/rule.md");
  assert.equal(raw[key].sha256, currentHash("content"));
  assert.equal(raw[key].level, "medium");
  assert.equal(raw[key].provenance, "user");
  assert.ok(typeof raw[key].approvedAt === "string");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("status: trusted (same hash) / changed (modified) / unknown (never approved)", (t) => {
  const file = tmpFile();
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  loadTrust(file);
  const target = path.join(path.dirname(file), "rule.md");
  approve(target, "one", "low", "user");
  assert.equal(status(target, "one"), "trusted");
  assert.equal(status(target, "two"), "changed"); // hash mismatch: approval invalid
  assert.equal(status(path.join(path.dirname(file), "other.md"), "one"), "unknown");
});

test("status: canonical key equivalence (relative vs absolute)", (t) => {
  const file = tmpFile();
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  loadTrust(file);
  approve("./rule.md", "x", "low", "user");
  assert.equal(status(path.resolve("rule.md"), "x"), "trusted");
});

test("revoke removes the entry and persists", (t) => {
  const file = tmpFile();
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  loadTrust(file);
  const target = path.join(path.dirname(file), "rule.md");
  approve(target, "x", "low", "user");
  revoke(target);
  assert.equal(status(target, "x"), "unknown");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8"))[target], undefined);
});

test("approving a second file keeps the first entry", (t) => {
  const file = tmpFile();
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  loadTrust(file);
  const a = path.join(path.dirname(file), "a.md");
  const b = path.join(path.dirname(file), "b.md");
  approve(a, "1", "low", "user");
  approve(b, "2", "high", "cli");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(raw[a].sha256, currentHash("1"));
  assert.equal(raw[b].sha256, currentHash("2"));
  assert.equal(status(a, "1"), "trusted");
  assert.equal(status(b, "2"), "trusted");
});

test("corrupt file -> warn + start empty, approve overwrites it", (t) => {
  const file = tmpFile();
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  fs.writeFileSync(file, "{ definitely not json");
  const store = loadTrust(file);
  assert.equal(store.size, 0); // no throw
  const target = path.join(path.dirname(file), "rule.md");
  approve(target, "x", "low", "user");
  assert.equal(status(target, "x"), "trusted");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8"))[target].sha256, currentHash("x"));
});

test("currentHash is sha256 hex of the raw string", () => {
  assert.equal(currentHash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("M-3: isCurrent rejects a file whose content changed since the gate hash", () => {
  const allowed = new Set(["a.md"]);
  const hashes = new Map([["a.md", currentHash("content A")]]);
  assert.equal(isCurrent(allowed, hashes, "a.md", "content A"), true);
  assert.equal(isCurrent(allowed, hashes, "a.md", "content B"), false); // swapped after gate
  assert.equal(isCurrent(allowed, hashes, "b.md", "content A"), false); // not gated
});

test("L-1: approval leaves no stale .tmp files behind", (t) => {
  const file = tmpFile();
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  loadTrust(file);
  approve("/x/a.md", "a", "low", "user");
  approve("/x/b.md", "b", "low", "user"); // second write exercises the rename path
  const leftovers = fs
    .readdirSync(path.dirname(file))
    .filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
});
