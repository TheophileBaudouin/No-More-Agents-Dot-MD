import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMetadata, matchEntries } from "./registry.ts";

test("parseMetadata: full metadata", () => {
	const e = parseMetadata(
		"author: theophilebaudouin\ncategory: workflow\ntags: [git, commits, style]\n",
		"conventional-commits",
	);
	assert.equal(e.name, "conventional-commits");
	assert.equal(e.author, "theophilebaudouin");
	assert.equal(e.category, "workflow");
	assert.deepEqual(e.tags, ["git", "commits", "style"]);
});

test("parseMetadata: missing fields default to empty", () => {
	const e = parseMetadata("author: x\n", "foo");
	assert.equal(e.category, "");
	assert.deepEqual(e.tags, []);
});

test("parseMetadata: empty tags array", () => {
	const e = parseMetadata("author: x\ncategory: y\ntags: []\n", "foo");
	assert.deepEqual(e.tags, []);
});

const ENTRIES = [
	{ name: "conventional-commits", author: "theo", category: "workflow", tags: ["git", "commits", "style"] },
	{ name: "assistant-ui", author: "theo", category: "ui", tags: ["svelte", "components"] },
];

test("matchEntries: name keyword beats tag keyword", () => {
	const r = matchEntries(ENTRIES, "commits");
	assert.equal(r[0].name, "conventional-commits");
});

test("matchEntries: tag match", () => {
	const r = matchEntries(ENTRIES, "svelte");
	assert.deepEqual(r.map((e) => e.name), ["assistant-ui"]);
});

test("matchEntries: case-insensitive, category and author searched", () => {
	assert.equal(matchEntries(ENTRIES, "WORKFLOW")[0].name, "conventional-commits");
	assert.equal(matchEntries(ENTRIES, "theo").length, 2);
});

test("matchEntries: no match / empty query", () => {
	assert.deepEqual(matchEntries(ENTRIES, "zzz"), []);
	assert.deepEqual(matchEntries(ENTRIES, "  "), []);
});