import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRule, validateRegex } from "./match.ts";

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
	const m = {
		tool: "bash",
		command: { regex: ["^git push", "^git reset --hard"] },
	};
	assert.equal(
		matchRule(m, { text: "{}", tool: "bash", command: "git push origin main" }),
		true,
	);
	assert.equal(
		matchRule(m, { text: "{}", tool: "bash", command: "git status" }),
		false,
	);
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
	assert.equal(
		matchRule({ input: "security" }, { text: "do a security review" }),
		true,
	);
});

test("model: provider alone matches case-insensitively", () => {
	const m = { model: "anthropic" };
	assert.equal(
		matchRule(m, { text: "", model: "anthropic/claude-sonnet-4" }),
		true,
	);
	assert.equal(matchRule(m, { text: "", model: "openai/gpt-5" }), false);
});

test("model: id alone and full provider/id", () => {
	assert.equal(
		matchRule({ model: "claude-sonnet-4" }, { text: "", model: "anthropic/claude-sonnet-4" }),
		true,
	);
	assert.equal(
		matchRule({ model: "anthropic/claude-sonnet-4" }, { text: "", model: "anthropic/claude-sonnet-4" }),
		true,
	);
});

test("model: list is any-of, case-insensitive", () => {
	const m = { model: ["ANTHROPIC", "openai"] };
	assert.equal(matchRule(m, { text: "", model: "anthropic/claude" }), true);
	assert.equal(matchRule(m, { text: "", model: "deepseek/deepseek-v4" }), false);
});

test("model: absent subject model never matches", () => {
	assert.equal(matchRule({ model: "anthropic" }, { text: "" }), false);
});

test("cwd: contains, regex and list", () => {
	const m = { cwd: "myproj" };
	assert.equal(
		matchRule(m, { text: "", cwd: "/Users/x/Documents/myproj/src" }),
		true,
	);
	assert.equal(matchRule(m, { text: "", cwd: "/Users/x/other" }), false);
	assert.equal(
		matchRule({ cwd: { regex: ["myproj\\/src$"] } }, { text: "", cwd: "/Users/x/myproj/src" }),
		true,
	);
	const m3 = { cwd: ["proj-a", "proj-b"] };
	assert.equal(matchRule(m3, { text: "", cwd: "/p/proj-b" }), true);
	assert.equal(matchRule(m3, { text: "", cwd: "/p/proj-c" }), false);
});

test("cwd: absent subject cwd never matches", () => {
	assert.equal(matchRule({ cwd: "myproj" }, { text: "" }), false);
});

test("sessionSize: number is a minimum", () => {
	const m = { sessionSize: 40 };
	assert.equal(matchRule(m, { text: "", sessionSize: 41 }), true);
	assert.equal(matchRule(m, { text: "", sessionSize: 40 }), true);
	assert.equal(matchRule(m, { text: "", sessionSize: 39 }), false);
});

test("sessionSize: {min,max} inclusive bounds", () => {
	const m = { sessionSize: { min: 5, max: 200 } };
	assert.equal(matchRule(m, { text: "", sessionSize: 5 }), true);
	assert.equal(matchRule(m, { text: "", sessionSize: 200 }), true);
	assert.equal(matchRule(m, { text: "", sessionSize: 4 }), false);
	assert.equal(matchRule(m, { text: "", sessionSize: 201 }), false);
});

test("sessionSize: absent subject value never matches", () => {
	assert.equal(matchRule({ sessionSize: 40 }, { text: "" }), false);
});

test("contextFill: number minimum and range", () => {
	const m = { contextFill: 80 };
	assert.equal(matchRule(m, { text: "", contextFill: 90 }), true);
	assert.equal(matchRule(m, { text: "", contextFill: 79 }), false);
	const m2 = { contextFill: { min: 10, max: 90 } };
	assert.equal(matchRule(m2, { text: "", contextFill: 50 }), true);
	assert.equal(matchRule(m2, { text: "", contextFill: 95 }), false);
});

test("result: patterns on tool output text", () => {
	const m = { result: { contains: ["FAILED"] } };
	assert.equal(
		matchRule(m, { text: "", result: "3 failed, 12 passed" }),
		true,
	);
	assert.equal(matchRule(m, { text: "", result: "all passed" }), false);
	assert.equal(
		matchRule({ result: { regex: ["error\\s+\\d+"] } }, { text: "", result: "error 42" }),
		true,
	);
	assert.equal(
		matchRule({ result: { regex: ["error\\s+\\d+"] } }, { text: "", result: "ok" }),
		false,
	);
});

test("result: absent subject result matches nothing", () => {
	assert.equal(matchRule({ result: { contains: ["x"] } }, { text: "" }), false);
});

test("source: exact equality, list, absent", () => {
	const m = { source: "interactive" };
	assert.equal(matchRule(m, { text: "", source: "interactive" }), true);
	assert.equal(matchRule(m, { text: "", source: "rpc" }), false);
	const m2 = { source: ["rpc", "extension"] };
	assert.equal(matchRule(m2, { text: "", source: "extension" }), true);
	assert.equal(matchRule(m2, { text: "", source: "interactive" }), false);
	assert.equal(matchRule(m, { text: "" }), false);
});

test("new keys combine with v1 keys (AND)", () => {
	const m = {
		tool: "bash",
		command: { contains: ["git push"] },
		model: "anthropic",
		sessionSize: 10,
	};
	const s = {
		text: "",
		tool: "bash",
		command: "git push origin",
		model: "anthropic/claude",
		sessionSize: 12,
	};
	assert.equal(matchRule(m, s), true);
	assert.equal(matchRule(m, { ...s, model: "openai/gpt" }), false);
	assert.equal(matchRule(m, { ...s, sessionSize: 5 }), false);
});

test("any failing with another key present still evaluates that key", () => {
	const m = { any: [{ input: { contains: ["zzz"] } }], sessionSize: 5 };
	assert.equal(matchRule(m, { text: "hello", sessionSize: 6 }), true);
	assert.equal(matchRule(m, { text: "hello", sessionSize: 3 }), false);
});

test("validateRegex: nested quantifiers are ReDoS-flagged", () => {
	assert.notEqual(validateRegex("(a+)+$"), null);
});

test("validateRegex: syntax errors are flagged", () => {
	assert.notEqual(validateRegex("(a++"), null);
});

test("validateRegex: overlong patterns are flagged", () => {
	assert.notEqual(validateRegex("x".repeat(300)), null);
});

test("validateRegex: benign anchored alternation passes", () => {
	assert.equal(validateRegex("^npm (install|ci)$"), null);
});

test("matchRule with an invalid regex returns false without throwing", () => {
	const m = { command: { regex: ["(a+)+$"] } };
	assert.equal(
		matchRule(m, { text: "{}", tool: "bash", command: "npm install" }),
		false,
	);
});

test("matchRule still matches valid regexes after an invalid one", () => {
	const m = { command: { regex: ["(a+)+$", "^git push"] } };
	assert.equal(
		matchRule(m, { text: "{}", tool: "bash", command: "git push origin main" }),
		true,
	);
});
