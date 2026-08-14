import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import createExtension from "./index.ts";

type Handler = (...args: any[]) => any;
type FakePi = {
	on: (ev: string, h: Handler) => void;
	registerCommand: (name: string, opts: { handler: Handler }) => void;
	handlers: Record<string, Handler>;
	commands: Record<string, Handler>;
	activeTools: string[];
	getActiveTools: () => string[];
	setActiveTools: (names: string[]) => void;
};

function makePi(): FakePi {
	const handlers: Record<string, Handler> = {};
	const commands: Record<string, Handler> = {};
	const activeTools: string[] = [];
	return {
		handlers,
		commands,
		activeTools,
		on: (ev: string, h: Handler) => void (handlers[ev] = h),
		registerCommand: (name: string, opts: { handler: Handler }) =>
			void (commands[name] = opts.handler),
		getActiveTools: () => [...activeTools],
		setActiveTools: (names: string[]) => {
			activeTools.length = 0;
			activeTools.push(...names);
		},
	};
}

/** Rich fake ctx for v2 tests: captures notify/editor calls. */
function makeCtx(overrides: Record<string, unknown> = {}) {
	const notifyCalls: Array<{ message: string; level?: string }> = [];
	const editorCalls: Array<{ title: string; text: string }> = [];
	const ui = {
		confirm: async () => true,
		notify: (message: string, level?: string) => void notifyCalls.push({ message, level }),
		editor: async (title: string, text: string) => void editorCalls.push({ title, text }),
		...(overrides.ui as Record<string, unknown> | undefined),
	};
	const ctx: Record<string, unknown> = {
		cwd: "/tmp/fake-proj",
		hasUI: false,
		model: undefined,
		sessionManager: { getEntries: () => [] },
		getContextUsage: () => undefined,
		...overrides,
	};
	ctx.ui = ui; // merged ui wins over overrides.ui
	return { ctx, notifyCalls, editorCalls };
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

	await pi.handlers["before_agent_start"]({
		prompt: "fix the ui",
		systemPrompt: "b",
	});
	const res2 = await pi.handlers["before_agent_start"]({
		prompt: "fix the ui",
		systemPrompt: "b",
	});
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
	assert.deepEqual(decline, {
		block: true,
		reason: "Blocked by rule git-safety",
	});

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

	await pi.handlers["tool_call"](
		{ toolName: "bash", input: { command: "pytest -x" } },
		{},
	);
	const res = await pi.handlers["context"]({
		messages: [{ role: "user", content: "hi" }],
	});
	assert.equal(res.messages.length, 2);
	assert.equal(res.messages[1].role, "user");
	assert.match(res.messages[1].content, /# Testing/);

	// queue is drained — next context event is untouched
	const res2 = await pi.handlers["context"]({
		messages: [{ role: "user", content: "hi" }],
	});
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

test("tool_call modify patches the bash command in place", async () => {
	const pi = makePi();
	createExtension(pi as any);
	const cwd = makeProject({
		".pi/context/modify.md": `---
name: capture-stderr
events: [tool_call]
match:
  tool: bash
  command: {contains: ["node"]}
action:
  type: modify
  command: {append: " 2>&1"}
---
`,
	});
	await pi.handlers["session_start"]({}, { cwd });

	const input = { command: "node script.js" };
	const res = await pi.handlers["tool_call"](
		{ toolName: "bash", input },
		{ hasUI: true, ui: { confirm: async () => true } },
	);
	assert.equal(res, undefined); // not blocked
	assert.equal(input.command, "node script.js 2>&1");

	fs.rmSync(cwd, { recursive: true, force: true });
});

// ---------------- v2 tests ----------------

const INPUT_TRANSFORM = `---
name: expand-tests
events: [input]
match:
  input: {contains: ["test"]}
action:
  type: transform
  text: "TEST FOCUS"
---
`;

const INPUT_HANDLED = `---
name: ping-pong
events: [input]
match:
  input: {contains: ["ping"]}
action:
  type: handled
---
`;

const RESULT_ANNOTATE = `---
name: test-failure-guide
events: [tool_result]
match:
  tool: bash
  result: {contains: ["FAILED"]}
action:
  type: annotate
  append: "Consultez le guide de test."
  details: {ok: false}
---
`;

test("input transform rewrites the prompt text", async () => {
	const pi = makePi();
	createExtension(pi as any);
	const cwd = makeProject({ ".pi/context/input.md": INPUT_TRANSFORM });
	await pi.handlers["session_start"]({}, { cwd });
	const { ctx } = makeCtx();

	const res = await pi.handlers["input"](
		{ text: "run the tests now", source: "interactive" },
		ctx,
	);
	assert.deepEqual(res, { action: "transform", text: "TEST FOCUS" });

	// unmatched input passes through untouched
	const res2 = await pi.handlers["input"](
		{ text: "hello world", source: "interactive" },
		ctx,
	);
	assert.equal(res2, undefined);

	fs.rmSync(cwd, { recursive: true, force: true });
});

test("input handled consumes the prompt without the agent", async () => {
	const pi = makePi();
	createExtension(pi as any);
	const cwd = makeProject({ ".pi/context/ping.md": INPUT_HANDLED });
	await pi.handlers["session_start"]({}, { cwd });
	const { ctx } = makeCtx();

	const res = await pi.handlers["input"](
		{ text: "ping", source: "interactive" },
		ctx,
	);
	assert.deepEqual(res, { action: "handled" });

	fs.rmSync(cwd, { recursive: true, force: true });
});

test("tool_result annotate patches content and details", async () => {
	const pi = makePi();
	createExtension(pi as any);
	const cwd = makeProject({ ".pi/context/guide.md": RESULT_ANNOTATE });
	await pi.handlers["session_start"]({}, { cwd });
	const { ctx } = makeCtx();

	const res = await pi.handlers["tool_result"](
		{
			toolName: "bash",
			input: { command: "pytest -x" },
			content: [{ type: "text", text: "FAILED: 2 failed" }],
			isError: true,
		},
		ctx,
	);
	assert.equal(res.content.length, 2);
	assert.deepEqual(res.content[1], { type: "text", text: "Consultez le guide de test." });
	assert.deepEqual(res.details, { ok: false });

	// non-matching output → no patch
	const res2 = await pi.handlers["tool_result"](
		{
			toolName: "bash",
			input: { command: "pytest -x" },
			content: [{ type: "text", text: "2 passed" }],
			isError: false,
		},
		ctx,
	);
	assert.equal(res2, undefined);

	fs.rmSync(cwd, { recursive: true, force: true });
});

const RESULT_INJECT = `---
name: after-test
events: [tool_result]
match:
  tool: bash
  command: {contains: ["pytest"]}
action:
  type: inject
  once: true
---

# Testing
Run the focused test file, not the whole suite.
`;

test("tool_result inject queues guidance delivered at the next context event", async () => {
	const pi = makePi();
	createExtension(pi as any);
	const cwd = makeProject({ ".pi/context/after-test.md": RESULT_INJECT });
	await pi.handlers["session_start"]({}, { cwd });
	const { ctx } = makeCtx();

	const res = await pi.handlers["tool_result"](
		{
			toolName: "bash",
			input: { command: "pytest -x" },
			content: [{ type: "text", text: "1 failed" }],
			isError: true,
		},
		ctx,
	);
	assert.equal(res, undefined); // inject alone produces no patch

	const cctx = await pi.handlers["context"]({
		messages: [{ role: "user", content: "hi" }],
	});
	assert.equal(cctx.messages.length, 2);
	assert.equal(cctx.messages[1].role, "user");
	assert.match(cctx.messages[1].content, /# Testing/);

	fs.rmSync(cwd, { recursive: true, force: true });
});

const USER_BASH_BLOCK = `---
name: no-manual-push
events: [user_bash]
match:
  command: {regex: ["^git push"]}
action:
  type: block
  message: "Pas de push manuel."
---
`;

test("user_bash block hard-blocks a manual command", async () => {
	const pi = makePi();
	createExtension(pi as any);
	const cwd = makeProject({ ".pi/context/push.md": USER_BASH_BLOCK });
	await pi.handlers["session_start"]({}, { cwd });

	const res = await pi.handlers["user_bash"](
		{ command: "git push origin main", excludeFromContext: false, cwd },
		{ hasUI: false },
	);
	assert.deepEqual(res, {
		result: { output: "Pas de push manuel.", exitCode: 1, cancelled: false, truncated: false },
	});

	fs.rmSync(cwd, { recursive: true, force: true });
});

const USER_BASH_MODIFY = `---
name: mark-manual
events: [user_bash]
match:
  command: {contains: ["echo"]}
action:
  type: modify
  command: {prepend: "echo MARK && "}
---
`;

test("user_bash modify wraps operations with prepend", async () => {
	const pi = makePi();
	createExtension(pi as any);
	const cwd = makeProject({ ".pi/context/mark.md": USER_BASH_MODIFY });
	await pi.handlers["session_start"]({}, { cwd });

	const res = await pi.handlers["user_bash"](
		{ command: "echo hi", excludeFromContext: false, cwd },
		{ hasUI: false },
	);
	assert.ok(res && res.operations && typeof res.operations.exec === "function");

	const chunks: string[] = [];
	const code = await res.operations.exec("echo hi", os.tmpdir(), {
		onData: (b: Buffer) => chunks.push(b.toString()),
	});
	assert.equal(code.exitCode, 0);
	assert.match(chunks.join(""), /MARK/);

	fs.rmSync(cwd, { recursive: true, force: true });
});

const SWITCH_BLOCK = `---
name: no-switch
events: [session_before_switch]
action:
  type: block
  message: "Sessions figées."
---
`;

test("session_before_switch block cancels the switch", async () => {
	const pi = makePi();
	createExtension(pi as any);
	const cwd = makeProject({ ".pi/context/switch.md": SWITCH_BLOCK });
	await pi.handlers["session_start"]({}, { cwd });
	const { ctx } = makeCtx({ hasUI: true });

	const res = await pi.handlers["session_before_switch"]({ reason: "new" }, ctx);
	assert.deepEqual(res, { cancel: true });

	fs.rmSync(cwd, { recursive: true, force: true });
});

const FORK_CONFIRM = `---
name: fork-check
events: [session_before_fork]
action:
  type: confirm
  message: "Forker ?"
---
`;

test("session_before_fork confirm declined cancels, approved passes", async () => {
	const pi = makePi();
	createExtension(pi as any);
	const cwd = makeProject({ ".pi/context/fork.md": FORK_CONFIRM });
	await pi.handlers["session_start"]({}, { cwd });

	const declined = await pi.handlers["session_before_fork"](
		{ entryId: "e1", position: "before" },
		makeCtx({ hasUI: true, ui: { confirm: async () => false } }).ctx,
	);
	assert.deepEqual(declined, { cancel: true });

	const approved = await pi.handlers["session_before_fork"](
		{ entryId: "e1", position: "before" },
		makeCtx({ hasUI: true, ui: { confirm: async () => true } }).ctx,
	);
	assert.equal(approved, undefined);

	fs.rmSync(cwd, { recursive: true, force: true });
});

const TOOLS_RULE = `---
name: context-tools
events: [input]
action:
  type: tools
  enable: [my_tool]
  disable: [bash]
---
`;

test("tools action enables and disables tools", async () => {
	const pi = makePi();
	pi.activeTools.push("read", "bash", "edit");
	createExtension(pi as any);
	const cwd = makeProject({ ".pi/context/tools.md": TOOLS_RULE });
	await pi.handlers["session_start"]({}, { cwd });
	const { ctx } = makeCtx();

	await pi.handlers["input"]({ text: "anything", source: "interactive" }, ctx);
	assert.deepEqual(pi.activeTools, ["read", "edit", "my_tool"]);

	fs.rmSync(cwd, { recursive: true, force: true });
});

const NOTIFY_RULE = `---
name: loud-rule
events: [input]
action:
  type: notify
  message: "Bonjour !"
  level: warning
---
`;

test("notify action calls ui.notify with message and level", async () => {
	const pi = makePi();
	createExtension(pi as any);
	const cwd = makeProject({ ".pi/context/loud.md": NOTIFY_RULE });
	await pi.handlers["session_start"]({}, { cwd });
	const { ctx, notifyCalls } = makeCtx({ hasUI: true });

	await pi.handlers["input"]({ text: "hello", source: "interactive" }, ctx);
	assert.deepEqual(notifyCalls, [{ message: "Bonjour !", level: "warning" }]);

	fs.rmSync(cwd, { recursive: true, force: true });
});

const LIST_RULE_A = `---
name: rule-a
events: [input]
action:
  type: notify
  message: "a"
---
`;

const LIST_RULE_B = `---
name: rule-b
events: [input]
action:
  type: notify
  message: "b"
---
`;

test("nma command lists rules and reload re-reads the directory", async () => {
	const pi = makePi();
	createExtension(pi as any);
	const cwd = makeProject({
		".pi/context/a.md": LIST_RULE_A,
		".pi/context/b.md": LIST_RULE_B,
	});
	await pi.handlers["session_start"]({}, { cwd });
	const { ctx, editorCalls, notifyCalls } = makeCtx({ cwd, hasUI: true });

	assert.ok(pi.commands["nma"], "nma command registered");

	await pi.commands["nma"]("", ctx);
	assert.equal(editorCalls[0].title, "nma rules");
	assert.match(editorCalls[0].text, /rule-a/);
	assert.match(editorCalls[0].text, /rule-b/);

	// add a rule file, reload, and list again
	fs.writeFileSync(path.join(cwd, ".pi/context/c.md"), LIST_RULE_A.replace("rule-a", "rule-c"));
	await pi.commands["nma"]("reload", ctx);
	assert.match(notifyCalls[0].message, /rechargée/);
	await pi.commands["nma"]("", ctx);
	assert.match(editorCalls[1].text, /rule-c/);

	fs.rmSync(cwd, { recursive: true, force: true });
});

test("nma status shows journal entries", async () => {
	const pi = makePi();
	createExtension(pi as any);
	const cwd = makeProject({ ".pi/context/loud.md": NOTIFY_RULE });
	await pi.handlers["session_start"]({}, { cwd });
	const { ctx, editorCalls } = makeCtx({ hasUI: true });

	await pi.handlers["input"]({ text: "hello", source: "interactive" }, ctx);
	await pi.commands["nma"]("status", ctx);
	assert.equal(editorCalls[0].title, "nma status");
	assert.match(editorCalls[0].text, /loud-rule/);
	assert.match(editorCalls[0].text, /notify/);

	fs.rmSync(cwd, { recursive: true, force: true });
});
