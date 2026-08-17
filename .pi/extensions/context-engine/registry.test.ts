import { test } from "node:test";
import assert from "node:assert/strict";
import {
	parseMetadata,
	matchEntries,
	fetchIndex,
	fetchContext,
	clearRegistryCache,
	setFetchForTests,
	type FetchLike,
} from "./registry.ts";

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

const TREE_JSON = {
	tree: [
		{ path: "registry/conventional-commits/context.md" },
		{ path: "registry/conventional-commits/metadata.yml" },
		{ path: "registry/assistant-ui/context.md" },
		{ path: "registry/assistant-ui/metadata.yml" },
		{ path: "README.md" },
	],
};

function fakeFetch(log: string[]): FetchLike {
	return async (url: string) => {
		log.push(url);
		if (url.includes("api.github.com")) {
			return { ok: true, status: 200, json: async () => TREE_JSON, text: async () => "" };
		}
		if (url.endsWith("conventional-commits/metadata.yml")) {
			return { ok: true, status: 200, json: async () => ({}), text: async () => "author: theo\ncategory: workflow\ntags: [git, commits]\n" };
		}
		if (url.endsWith("assistant-ui/metadata.yml")) {
			return { ok: true, status: 200, json: async () => ({}), text: async () => "author: theo\ncategory: ui\ntags: [svelte]\n" };
		}
		if (url.endsWith("assistant-ui/context.md")) {
			return { ok: true, status: 200, json: async () => ({}), text: async () => "# Assistant UI\n" };
		}
		return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
	};
}

test("fetchIndex: lists names from tree, fetches metadata, caches", async () => {
	clearRegistryCache();
	const log: string[] = [];
	const entries = await fetchIndex(fakeFetch(log));
	assert.equal(entries.length, 2);
	assert.equal(entries.find((e) => e.name === "conventional-commits")?.category, "workflow");
	// Second call within TTL: no new fetch
	const again = await fetchIndex(fakeFetch(log));
	assert.equal(again.length, 2);
	assert.equal(log.filter((u) => u.includes("api.github.com")).length, 1);
	clearRegistryCache();
});

test("fetchIndex: metadata fetch failure skips the entry", async () => {
	clearRegistryCache();
	const log: string[] = [];
	const base = fakeFetch(log);
	const flaky: FetchLike = async (url, init) => {
		if (url.endsWith("assistant-ui/metadata.yml")) throw new Error("boom");
		return base(url, init);
	};
	const entries = await fetchIndex(flaky);
	assert.deepEqual(entries.map((e) => e.name), ["conventional-commits"]);
	clearRegistryCache();
});

test("fetchIndex: tree fetch failure throws", async () => {
	clearRegistryCache();
	const down: FetchLike = async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => "" });
	await assert.rejects(() => fetchIndex(down), /HTTP 403/);
	clearRegistryCache();
});

test("fetchContext: ok returns text, 404 throws", async () => {
	const log: string[] = [];
	assert.equal(await fetchContext("assistant-ui", fakeFetch(log)), "# Assistant UI\n");
	await assert.rejects(() => fetchContext("nope", fakeFetch(log)), /HTTP 404/);
});

test("setFetchForTests: handler-level injection seam", async () => {
	clearRegistryCache();
	const log: string[] = [];
	setFetchForTests(fakeFetch(log));
	const entries = await fetchIndex();
	assert.equal(entries.length, 2);
	setFetchForTests(undefined);
	clearRegistryCache();
});