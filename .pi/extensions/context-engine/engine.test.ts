import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseContextFile, loadContextDir, selectInject, selectToolRules, selectForEvent } from "./engine.ts";

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

test("loadContextDir filter skips rejected files before parsing", () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-"));
 fs.writeFileSync(path.join(dir, "keep.md"), UI_RULE);
 fs.writeFileSync(path.join(dir, "drop.md"), UI_RULE.replace("ui-context", "drop-rule"));
 const rules = loadContextDir(
  dir,
  (file, raw) => file === "keep.md" && raw.includes("ui-context"),
 );
 assert.equal(rules.length, 1);
 assert.equal(rules[0].name, "ui-context");
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

test("parseContextFile parses all 9 action forms", () => {
 const cases: Array<[string, string]> = [
  ["inject", "action: {type: inject}"],
  ["confirm", "action: {type: confirm, message: \"ok?\"}"],
  ["block", "action: {type: block, message: \"no\"}"],
  ["modify", "action: {type: modify, command: {append: \" --verbose\", prepend: \"echo hi; \"}}"],
  ["tools", "action: {type: tools, enable: [git_status], disable: [bash]}"],
  ["notify", "action: {type: notify, message: \"hello\", level: warning}"],
  ["transform", "action: {type: transform, text: \"new text\"}"],
  ["handled", "action: {type: handled}"],
  ["annotate", "action: {type: annotate, append: \"see docs\", details: {k: 1}}"],
 ];
 for (const [type, actionYaml] of cases) {
  const events =
   type === "transform" || type === "handled"
    ? "input"
    : type === "annotate"
      ? "tool_result"
      : "tool_call";
  const rule = parseContextFile(
   `---\nname: ${type}\nevents: [${events}]\n${actionYaml}\n---\nbody`,
   `${type}.md`,
  )!;
  assert.equal(rule.action.type, type);
 }
 // field-level checks on representative rules
 const tools = parseContextFile(
  "---\nname: t\nevents: [tool_call]\naction: {type: tools, enable: [git_status], disable: [bash]}\n---\n",
  "t.md",
 )!;
 assert.deepEqual(tools.action.enable, ["git_status"]);
 assert.deepEqual(tools.action.disable, ["bash"]);
 const notify = parseContextFile(
  "---\nname: n\nevents: [input]\naction: {type: notify, message: \"hi\", level: warning}\n---\n",
  "n.md",
 )!;
 assert.equal(notify.action.level, "warning");
 assert.equal(notify.action.message, "hi");
 const annotate = parseContextFile(
  "---\nname: a\nevents: [tool_result]\naction: {type: annotate, append: \"docs\", details: {k: 1}}\n---\n",
  "a.md",
 )!;
 assert.equal(annotate.action.append, "docs");
 assert.deepEqual(annotate.action.details, { k: 1 });
 const modify = parseContextFile(
  "---\nname: m\nevents: [tool_call]\naction: {type: modify, command: {append: \" --verbose\", prepend: \"echo hi; \"}}\n---\n",
  "m.md",
 )!;
 assert.deepEqual(modify.action.command, { append: " --verbose", prepend: "echo hi; " });
});

test("parseContextFile rejects unknown events", () => {
 assert.throws(
  () => parseContextFile("---\nname: x\nevents: [nope]\naction: {type: block}\n---\n", "x.md"),
  /unknown event "nope"/,
 );
 assert.throws(
  () =>
   parseContextFile(
    "---\nname: x\nevents: [tool_call, nope]\naction: {type: block}\n---\n",
    "x.md",
   ),
  /unknown event "nope"/,
 );
});

test("parseContextFile rejects unknown action types", () => {
 assert.throws(
  () => parseContextFile("---\nname: x\nevents: [tool_call]\naction: {type: explode}\n---\n", "x.md"),
  /unknown action.type "explode"/,
 );
});

test("parseContextFile rejects action incompatible with the event", () => {
 assert.throws(
  () => parseContextFile("---\nname: a\nevents: [input]\naction: {type: annotate}\n---\n", "a.md"),
  /not allowed for event "input"/,
 );
 assert.throws(
  () => parseContextFile("---\nname: t\nevents: [tool_call]\naction: {type: transform}\n---\n", "t.md"),
  /not allowed/,
 );
 assert.throws(
  () => parseContextFile("---\nname: u\nevents: [user_bash]\naction: {type: inject}\n---\n", "u.md"),
  /not allowed/,
 );
});

test("selectForEvent filters by event and match", () => {
 const inject = parseContextFile(UI_RULE, "ui.md")!;
 const guard = parseContextFile(
  "---\nname: g\nevents: [tool_call]\nmatch:\n  tool: bash\naction: {type: block}\n---\n",
  "g.md",
 )!;
 const rules = [inject, guard];
 assert.equal(selectForEvent(rules, { text: "improve the ui" }, "before_agent_start").length, 1);
 assert.equal(selectForEvent(rules, { text: "improve the ui" }, "tool_call").length, 0);
 assert.equal(selectForEvent(rules, { text: "{}", tool: "bash" }, "tool_call").length, 1);
 assert.equal(selectForEvent(rules, { text: "improve the ui" }, "input").length, 0);
});

test("selectForEvent matches subject dimensions", () => {
 const r = parseContextFile(
  "---\nname: m\nevents: [input]\nmatch:\n  model: anthropic\n  sessionSize: 5\naction: {type: notify, message: \"x\"}\n---\n",
  "m.md",
 )!;
 const rules = [r];
 assert.equal(
  selectForEvent(rules, { text: "t", model: "anthropic/claude-sonnet-4", sessionSize: 10 }, "input").length,
  1,
 );
 assert.equal(
  selectForEvent(rules, { text: "t", model: "openai/gpt-5", sessionSize: 10 }, "input").length,
  0,
 );
 assert.equal(
  selectForEvent(rules, { text: "t", model: "anthropic/claude-sonnet-4", sessionSize: 3 }, "input").length,
  0,
 );
});
