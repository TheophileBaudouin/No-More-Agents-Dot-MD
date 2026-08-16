import { test } from "node:test";
import assert from "node:assert/strict";
import { mkFinding } from "./types.ts";
import { nudgeLevel, provenance } from "./scan.ts";

const NOW = new Date("2026-08-16T12:00:00Z");
const RECENT = NOW.getTime() - 10 * 60 * 1000; // 10 minutes ago
const OLD = NOW.getTime() - 2 * 3600 * 1000; // 2 hours ago

test("provenance: default is user", () => {
  assert.equal(provenance("a.md", { isProjectTrusted: true, now: NOW }), "user");
});

test("provenance: untrusted project -> untrusted-project", () => {
  assert.equal(
    provenance("a.md", { isProjectTrusted: false, now: NOW }),
    "untrusted-project",
  );
});

test("provenance: recent untracked file -> downloaded (takes precedence)", () => {
  const sig = { isProjectTrusted: false, now: NOW, mtimeMs: RECENT, gitTracked: false };
  assert.equal(provenance("a.md", sig), "downloaded");
});

test("provenance: tracked recent file -> user", () => {
  assert.equal(
    provenance("a.md", { isProjectTrusted: true, now: NOW, mtimeMs: RECENT, gitTracked: true }),
    "user",
  );
});

test("provenance: untracked but old file -> user", () => {
  assert.equal(
    provenance("a.md", { isProjectTrusted: true, now: NOW, mtimeMs: OLD, gitTracked: false }),
    "user",
  );
});

test("provenance: exactly one hour old is not downloaded", () => {
  assert.equal(
    provenance("a.md", {
      isProjectTrusted: true,
      now: NOW,
      mtimeMs: NOW.getTime() - 3600000,
      gitTracked: false,
    }),
    "user",
  );
});

const f = (sev: "low" | "medium" | "high") => mkFinding("x", "command", sev, "low", "x");

test("nudge: none never rises", () => {
  assert.equal(nudgeLevel("none", "downloaded", [f("medium")]), "none");
});

test("nudge: low -> medium", () => {
  assert.equal(nudgeLevel("low", "downloaded", [f("medium")]), "medium");
});

test("nudge: medium -> high", () => {
  assert.equal(nudgeLevel("medium", "untrusted-project", [f("medium")]), "high");
});

test("nudge: high stays high without a terminal finding", () => {
  assert.equal(nudgeLevel("high", "downloaded", [f("high")]), "high");
});

test("nudge: high -> critical only with a terminal finding", () => {
  const terminal = mkFinding("x", "command", "high", "high", "x", { terminal: true });
  assert.equal(nudgeLevel("high", "downloaded", [terminal]), "critical");
});

test("nudge: critical stays critical", () => {
  assert.equal(nudgeLevel("critical", "downloaded", [f("high")]), "critical");
});

test("nudge: user provenance never nudges", () => {
  assert.equal(nudgeLevel("low", "user", [f("medium")]), "low");
});

test("nudge: no findings never nudges", () => {
  assert.equal(nudgeLevel("low", "downloaded", []), "low");
});
