import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import createExtension from "./index.ts";

type Handler = (event: any, ctx: any) => unknown;
type FakePi = { on: (ev: string, h: Handler) => void; handlers: Record<string, Handler> };

function makePi(): FakePi {
 const handlers: Record<string, Handler> = {};
 return {
  handlers,
  on: (ev: string, h: Handler) => void (handlers[ev] = h),
 };
}

function makeProject(files: Record<string, string>): string {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proj-"));
 for (const [rel, content] of Object.entries(files)) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
 }
 return dir;
}

const UI_RULE = `---
name: ui-context
description: UI conventions
events: [before_agent_start]
match:
  input: {contains: [ui, ux]}
action:
  type: inject
  once: true
---

# UI Conventions
Use existing components.
`;

const GIT_GUARD = `---
name: git-safety
description: Confirm destructive git commands
events: [tool_call]
match:
  tool: bash
  command: {regex: ["^git push", "^git reset --hard"]}
action:
  type: confirm
  message: "Commande Git potentiellement destructive."
priority: high
---
`;

const TOOL_CONTEXT = `---
name: test-context
description: Testing conventions after a test command runs
events: [tool_call]
match:
  tool: bash
  command: {contains: ["pytest", "vitest", "go test"]}
action:
  type: inject
  once: true
---

# Testing
Run the focused test file, not the whole suite.
`;

test("before_agent_start injects matched context into the system prompt", async () => {
 const pi = makePi();
 createExtension(pi as any);
 const cwd = makeProject({ ".pi/context/ui.md": UI_RULE });
 await pi.handlers["session_start"]({}, { cwd });

 const res = await pi.handlers["before_agent_start"]({
  prompt: "fix the ui layout",
  systemPrompt: "base",
 });
 assert.match(res.systemPrompt, /# UI Conventions/);
 assert.match(res.systemPrompt, /Use existing components/);
 assert.ok(res.systemPrompt.startsWith("base"));

 // unmatched prompt → no injection
 const res2 = await pi.handlers["before_agent_start"]({
  prompt: "bump the version",
  systemPrompt: "base",
 });
 assert.equal(res2, undefined);

 fs.rmSync(cwd, { recursive: true, force: true });
});

test("once: true injects only on the first matching turn", async () => {
 const pi = makePi();
 createExtension(pi as any);
 const cwd = makeProject({ ".pi/context/ui.md": UI_RULE });
 await pi.handlers["session_start"]({}, { cwd });

 await pi.handlers["before_agent_start"]({ prompt: "fix the ui", systemPrompt: "b" });
 const res2 = await pi.handlers["before_agent_start"]({ prompt: "fix the ui", systemPrompt: "b" });
 assert.equal(res2, undefined);

 fs.rmSync(cwd, { recursive: true, force: true });
});

test("tool_call confirm blocks when declined, passes when approved", async () => {
 const pi = makePi();
 createExtension(pi as any);
 const cwd = makeProject({ ".pi/context/git-safety.md": GIT_GUARD });
 await pi.handlers["session_start"]({}, { cwd });

 const decline = await pi.handlers["tool_call"](
  { toolName: "bash", input: { command: "git push origin main" } },
  { hasUI: true, ui: { confirm: async () => false } },
 );
 assert.deepEqual(decline, { block: true, reason: "Blocked by rule git-safety" });

 const approve = await pi.handlers["tool_call"](
  { toolName: "bash", input: { command: "git push origin main" } },
  { hasUI: true, ui: { confirm: async () => true } },
 );
 assert.equal(approve, undefined); // not blocked

 fs.rmSync(cwd, { recursive: true, force: true });
});

test("tool_call confirm fails safe without UI", async () => {
 const pi = makePi();
 createExtension(pi as any);
 const cwd = makeProject({ ".pi/context/git-safety.md": GIT_GUARD });
 await pi.handlers["session_start"]({}, { cwd });

 const res = await pi.handlers["tool_call"](
  { toolName: "bash", input: { command: "git push origin main" } },
  { hasUI: false },
 );
 assert.equal(res.block, true);

 fs.rmSync(cwd, { recursive: true, force: true });
});

test("tool_call inject queues guidance delivered at the next context event", async () => {
 const pi = makePi();
 createExtension(pi as any);
 const cwd = makeProject({ ".pi/context/test-context.md": TOOL_CONTEXT });
 await pi.handlers["session_start"]({}, { cwd });

 await pi.handlers["tool_call"]({ toolName: "bash", input: { command: "pytest -x" } }, {});
 const res = await pi.handlers["context"]({ messages: [{ role: "user", content: "hi" }] });
 assert.equal(res.messages.length, 2);
 assert.equal(res.messages[1].role, "system");
 assert.match(res.messages[1].content, /# Testing/);

 // queue is drained — next context event is untouched
 const res2 = await pi.handlers["context"]({ messages: [{ role: "user", content: "hi" }] });
 assert.equal(res2, undefined);

 fs.rmSync(cwd, { recursive: true, force: true });
});

test("tool_call block hard-blocks a matched command", async () => {
 const pi = makePi();
 createExtension(pi as any);
 const cwd = makeProject({
  ".pi/context/block.md": `---
name: never-ls
events: [tool_call]
match:
  tool: bash
  command: {regex: ["^ls"]}
action:
  type: block
  message: "ls is banned"
---
`,
 });
 await pi.handlers["session_start"]({}, { cwd });

 const res = await pi.handlers["tool_call"](
  { toolName: "bash", input: { command: "ls -la" } },
  { hasUI: true, ui: { confirm: async () => true } },
 );
 assert.deepEqual(res, { block: true, reason: "ls is banned" });

 fs.rmSync(cwd, { recursive: true, force: true });
});
