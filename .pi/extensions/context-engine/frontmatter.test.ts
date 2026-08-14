import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYamlSubset } from "./frontmatter.ts";

test("parses flat key-value pairs and inline lists", () => {
 assert.deepEqual(
  parseYamlSubset("name: ui-context\ndescription: Conventions UI\nevents: [before_agent_start]"),
  { name: "ui-context", description: "Conventions UI", events: ["before_agent_start"] },
 );
});

test("parses nested maps with block lists", () => {
 const out = parseYamlSubset(`match:
  tool: bash
  command:
    regex:
      - "^git push"
      - "^git reset --hard"`);
 assert.deepEqual(out, {
  match: { tool: "bash", command: { regex: ["^git push", "^git reset --hard"] } },
 });
});

test("parses a list of maps (match.any)", () => {
 const out = parseYamlSubset(`match:
  any:
    - input:
        contains: [test]
    - tool: bash`);
 assert.deepEqual(out, {
  match: { any: [{ input: { contains: ["test"] } }, { tool: "bash" }] },
 });
});

test("parses inline maps", () => {
 assert.deepEqual(parseYamlSubset("match:\n  input: {contains: [ui, ux]}"), {
  match: { input: { contains: ["ui", "ux"] } },
 });
});

test("parses booleans, quoted strings, bare flags", () => {
 assert.deepEqual(
  parseYamlSubset('once: true\npriority: normal\nmessage: "git push"\nnotes: '),
  { once: true, priority: "normal", message: "git push", notes: true },
 );
});

test("comments and empty lines are ignored", () => {
 assert.deepEqual(parseYamlSubset("# header comment\n\nname: x\n"), { name: "x" });
});

test("rejects lines without a colon", () => {
 assert.throws(() => parseYamlSubset("this line has no colon"));
});

test("returns empty object for empty input", () => {
 assert.deepEqual(parseYamlSubset(""), {});
});
