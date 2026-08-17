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