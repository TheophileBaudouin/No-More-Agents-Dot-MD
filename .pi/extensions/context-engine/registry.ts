/**
 * Client for the community context registry
 * (github.com/TheophileBaudouin/awesome-No-More-Agents-Dot-MD).
 */

export type RegistryEntry = {
	name: string;
	author: string;
	category: string;
	tags: string[];
};

// ponytail: single-line `key: value` fields with inline `[a, b]` arrays only —
// the registry CI (scripts/validate.ts) enforces this shape. Switch to a real
// YAML parser if the schema ever grows multi-line values.
export function parseMetadata(yml: string, name: string): RegistryEntry {
	const field = (key: string): string =>
		yml.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
	const tagsRaw = field("tags").replace(/^\[|\]$/g, "");
	return {
		name,
		author: field("author"),
		category: field("category"),
		tags: tagsRaw
			? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
			: [],
	};
}

/**
 * Rank entries against a whitespace-split keyword query. Every keyword must
 * hit something (name > tag > category > author); no hit on a keyword = 0.
 */
export function matchEntries(
	entries: RegistryEntry[],
	query: string,
): RegistryEntry[] {
	const kws = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (kws.length === 0) return [];
	const score = (e: RegistryEntry): number => {
		const name = e.name.toLowerCase();
		let s = 0;
		for (const kw of kws) {
			if (name.includes(kw)) s += 10;
			else if (e.tags.some((t) => t.toLowerCase().includes(kw))) s += 5;
			else if (e.category.toLowerCase().includes(kw)) s += 3;
			else if (e.author.toLowerCase().includes(kw)) s += 1;
			else return 0;
		}
		return s;
	};
	return entries
		.map((e) => ({ e, s: score(e) }))
		.filter((x) => x.s > 0)
		.sort((a, b) => b.s - a.s)
		.map((x) => x.e);
}

import { NETWORK_TIMEOUT_MS } from "./security/config.ts";

const REGISTRY_REPO = "TheophileBaudouin/awesome-No-More-Agents-Dot-MD";
const TREE_URL = `https://api.github.com/repos/${REGISTRY_REPO}/git/trees/main?recursive=1`;
const RAW_BASE = `https://raw.githubusercontent.com/${REGISTRY_REPO}/main/registry`;

export type FetchLike = (
	url: string,
	init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
	text(): Promise<string>;
}>;

// ponytail: module-level fetch override is the test seam for the command
// handler (urlhaus.ts uses param injection; the handler can't reach params).
let fetchImpl: FetchLike | undefined;
export function setFetchForTests(f: FetchLike | undefined): void {
	fetchImpl = f;
}

// ponytail: in-memory session cache, 10 min TTL. The unauthenticated trees
// API allows 60 req/h; one call per session per project is far under that.
// Add a disk cache only if sessions prove to refetch often.
const CACHE_TTL_MS = 10 * 60 * 1000;
let indexCache: { at: number; entries: RegistryEntry[] } | null = null;
export function clearRegistryCache(): void {
	indexCache = null;
}

export async function fetchIndex(f: FetchLike = fetchImpl ?? fetch): Promise<RegistryEntry[]> {
	if (indexCache && Date.now() - indexCache.at < CACHE_TTL_MS) return indexCache.entries;
	const res = await f(TREE_URL, {
		headers: { "User-Agent": "no-more-agents-dot-md", Accept: "application/vnd.github+json" },
		signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS * 3),
	});
	if (!res.ok) throw new Error(`registry tree fetch failed: HTTP ${res.status}`);
	const data = (await res.json()) as { tree?: { path?: string }[] };
	const names = [
		...new Set(
			(data.tree ?? [])
				// Filename-safe slug only: a backslash or space in a name would
				// become a path segment surprise when the .md is written locally.
				.map((t) => t.path?.match(/^registry\/([A-Za-z0-9._-]+)\/context\.md$/)?.[1])
				.filter((n): n is string => !!n),
		),
	];
	const settled = await Promise.all(
		names.map(async (name) => {
			try {
				const r = await f(`${RAW_BASE}/${name}/metadata.yml`, {
					signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
				});
				if (!r.ok) return null;
				return parseMetadata(await r.text(), name);
			} catch {
				return null;
			}
		}),
	);
	const entries = settled.filter((e): e is RegistryEntry => !!e);
	indexCache = { at: Date.now(), entries };
	return entries;
}

export async function fetchContext(
	name: string,
	f: FetchLike = fetchImpl ?? fetch,
): Promise<string> {
	const res = await f(`${RAW_BASE}/${name}/context.md`, {
		signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS * 3),
	});
	if (!res.ok) throw new Error(`context fetch failed for "${name}": HTTP ${res.status}`);
	return res.text();
}