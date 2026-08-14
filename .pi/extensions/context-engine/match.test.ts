import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRule } from "./match.ts";
import type { Subject } from "./match.ts";

test("no match spec matches everything", () => {
 assert.equal(matchRule(undefined, { text: "anything" }), true);
});

test("input contains is case-insensitive, any-of", () => {
 const m = { input: { contains: ["ui", "ux", "user interface"] } };
 assert.equal(matchRule(m, { text: "FIX THE UI" }), true);
 assert.equal(matchRule(m, { text: "user interface work" }), true);
 assert.equal(matchRule(m, { text: "bump the version" }), false);
});

test("input regex is any-of", () => {
 const m = { input: { regex: ["^git push", "^git reset"] } };
 assert.equal(matchRule(m, { text: "git push origin main" }), true);
 assert.equal(matchRule(m, { text: "git status" }), false);
});

test("tool + command matching on a bash subject", () => {
 const m = { tool: "bash", command: { regex: ["^git push", "^git reset --hard"] } };
 assert.equal(
  matchRule(m, { text: "{}", tool: "bash", command: "git push origin main" }),
  true,
 );
 assert.equal(matchRule(m, { text: "{}", tool: "bash", command: "git status" }), false);
 assert.equal(matchRule(m, { text: "{}", tool: "read", command: "" }), false);
});

test("tool accepts a list of names", () => {
 const m = { tool: ["bash", "git"] };
 assert.equal(matchRule(m, { text: "", tool: "bash", command: "ls" }), true);
 assert.equal(matchRule(m, { text: "", tool: "read" }), false);
});

test("any: OR across sub-specs wins immediately", () => {
 const m = { any: [{ input: { contains: ["test"] } }, { tool: "bash" }] };
 assert.equal(matchRule(m, { text: "write a test" }), true);
 assert.equal(matchRule(m, { text: "x", tool: "bash", command: "ls" }), true);
 assert.equal(matchRule(m, { text: "refactor", tool: "read" }), false);
});

test("plain string input pattern is a substring", () => {
 assert.equal(matchRule({ input: "security" }, { text: "do a security review" }), true);
});
