import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseContextFile, loadContextDir, selectInject, selectToolRules } from "./engine.ts";

const UI_RULE = `---
name: ui-context
description: UI conventions
events: [before_agent_start]
match:
  input:
    contains: [ui, ux]
action:
  type: inject
  once: true
---

# UI Conventions
Use existing components before writing new ones.
`;

test("parseContextFile extracts metadata and body", () => {
 const rule = parseContextFile(UI_RULE, "ui.md")!;
 assert.equal(rule.name, "ui-context");
 assert.equal(rule.description, "UI conventions");
 assert.deepEqual(rule.events, ["before_agent_start"]);
 assert.equal(rule.action.type, "inject");
 assert.equal(rule.action.once, true);
 assert.equal(rule.priority, 2); // normal
 assert.match(rule.body, /# UI Conventions/);
});

test("parseContextFile returns null without frontmatter", () => {
 assert.equal(parseContextFile("# Just documentation\n", "README.md"), null);
});

test("parseContextFile throws when name is missing", () => {
 assert.throws(() =>
  parseContextFile("---\nevents: [tool_call]\naction: {type: block}\n---\nbody", "x.md"),
 );
});

test("parseContextFile maps priority strings", () => {
 const high = parseContextFile(UI_RULE.replace("action:", "priority: high\naction:"), "h.md")!;
 const low = parseContextFile(UI_RULE.replace("action:", "priority: low\naction:"), "l.md")!;
 assert.equal(high.priority, 3);
 assert.equal(low.priority, 1);
});

test("loadContextDir reads real files, skips README, sorts by priority", () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-"));
 fs.writeFileSync(path.join(dir, "ui.md"), UI_RULE);
 fs.writeFileSync(path.join(dir, "guard.md"),
  "---\nname: git-safety\nevents: [tool_call]\npriority: high\naction: {type: block}\n---\n");
 fs.writeFileSync(path.join(dir, "README.md"), "# docs");
 const rules = loadContextDir(dir);
 assert.equal(rules.length, 2);
 assert.equal(rules[0].name, "git-safety"); // high priority first
 assert.equal(rules[1].name, "ui-context");
 fs.rmSync(dir, { recursive: true, force: true });
});

test("loadContextDir returns [] for missing dir and tolerates broken files", () => {
 assert.deepEqual(loadContextDir("/nonexistent/xyz"), []);
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-"));
 fs.writeFileSync(path.join(dir, "broken.md"), "---\nnope\n---\nx");
 assert.deepEqual(loadContextDir(dir), []);
 fs.rmSync(dir, { recursive: true, force: true });
});

test("selectInject gates on keyword match and once", () => {
 const rules = [parseContextFile(UI_RULE, "ui.md")!];
 const injected = new Set<string>();
 assert.equal(selectInject(rules, { text: "improve the ui" }, injected).length, 1);
 assert.equal(selectInject(rules, { text: "bump version" }, injected).length, 0);
 // once: marked rules are excluded on later turns
 injected.add("ui-context");
 assert.equal(selectInject(rules, { text: "improve the ui" }, injected).length, 0);
});

test("selectToolRules matches tool_call rules", () => {
 const guard = parseContextFile(
  "---\nname: g\nevents: [tool_call]\nmatch:\n  tool: bash\n  command: {regex: [\"^git push\"]}\naction: {type: confirm}\n---\n",
  "g.md",
 )!;
 const rules = [guard];
 assert.equal(selectToolRules(rules, { text: "{}", tool: "bash", command: "git push" }).length, 1);
 assert.equal(selectToolRules(rules, { text: "{}", tool: "bash", command: "ls" }).length, 0);
});
