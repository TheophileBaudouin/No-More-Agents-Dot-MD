import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMetadata } from "./registry.ts";

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