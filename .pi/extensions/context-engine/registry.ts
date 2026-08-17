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