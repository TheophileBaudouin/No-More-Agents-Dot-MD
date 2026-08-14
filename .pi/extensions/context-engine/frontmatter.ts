/**
 * Minimal YAML-subset parser for context-file frontmatter.
 * Supports: `key: value`, inline lists `[a, b]`, inline maps `{a: 1}`,
 * block lists (`- item`), and 2-space-indented nested maps/lists.
 * Not a general YAML parser — throws on anything else.
 */

type Tok =
	| { indent: number; key: string; value: string }
	| {
			indent: number;
			item: string;
			mapItemKey?: string;
			mapItemValue?: string;
	  };

function tokenize(text: string): Tok[] {
	const toks: Tok[] = [];
	for (const raw of text.split("\n")) {
		const t = raw.trim();
		if (!t || t.startsWith("#")) continue;
		const indent = raw.length - raw.trimStart().length;
		if (t.startsWith("- ")) {
			const rest = t.slice(2).trim();
			const i = rest.indexOf(":");
			if (i !== -1) {
				toks.push({
					indent,
					item: "",
					mapItemKey: rest.slice(0, i).trim(),
					mapItemValue: rest.slice(i + 1).trim(),
				});
			} else {
				toks.push({ indent, item: rest });
			}
		} else if (t.startsWith("-")) {
			throw new Error(`Invalid list item: "${t}"`);
		} else {
			const i = t.indexOf(":");
			if (i === -1) throw new Error(`Expected "key: value", got "${t}"`);
			toks.push({
				indent,
				key: t.slice(0, i).trim(),
				value: t.slice(i + 1).trim(),
			});
		}
	}
	return toks;
}

function parseScalar(v: string): string | number | boolean | null {
	if (
		v.length >= 2 &&
		((v.startsWith('"') && v.endsWith('"')) ||
			(v.startsWith("'") && v.endsWith("'")))
	) {
		return v.slice(1, -1);
	}
	if (v === "true") return true;
	if (v === "false") return false;
	if (v === "null") return null;
	const n = Number(v);
	return v !== "" && !Number.isNaN(n) ? n : v;
}

// Split on commas only outside brackets, so inline maps can contain inline
// lists (`{contains: [ui, ux]}`). Deviation from plan: the plan's naive
// split(",") broke on commas inside bracket values.
function splitTopLevel(s: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let cur = "";
	for (const ch of s) {
		if (ch === "[" || ch === "{") depth++;
		else if (ch === "]" || ch === "}") depth--;
		if (ch === "," && depth === 0) {
			parts.push(cur);
			cur = "";
		} else {
			cur += ch;
		}
	}
	parts.push(cur);
	return parts;
}

function parseValue(v: string): unknown {
	if (v.startsWith("[") && v.endsWith("]")) {
		const inner = v.slice(1, -1).trim();
		return inner === ""
			? []
			: inner.split(",").map((s) => parseScalar(s.trim()));
	}
	if (v.startsWith("{") && v.endsWith("}")) {
		const inner = v.slice(1, -1).trim();
		if (!inner) return {};
		const map: Record<string, unknown> = {};
		for (const pair of splitTopLevel(inner)) {
			const i = pair.indexOf(":");
			map[pair.slice(0, i).trim()] = parseValue(pair.slice(i + 1).trim());
		}
		return map;
	}
	return parseScalar(v);
}

export function parseYamlSubset(text: string): Record<string, unknown> {
	const toks = tokenize(text);
	let i = 0;

	function parseBlock(indent: number): unknown {
		return "key" in toks[i] ? parseMap(indent) : parseList(indent);
	}

	function parseMap(indent: number): Record<string, unknown> {
		const map: Record<string, unknown> = {};
		while (i < toks.length && toks[i].indent === indent) {
			const tok = toks[i];
			if (!("key" in tok)) break; // next sibling is a list item (or EOF)
			i++;
			if (tok.value === "") {
				if (i < toks.length && toks[i].indent > indent) {
					map[tok.key] = parseBlock(toks[i].indent);
				} else {
					map[tok.key] = true; // bare flag
				}
			} else {
				map[tok.key] = parseValue(tok.value);
			}
		}
		return map;
	}

	function parseList(indent: number): unknown[] {
		const list: unknown[] = [];
		while (i < toks.length && toks[i].indent === indent) {
			const tok = toks[i];
			if ("key" in tok) break; // next sibling is a map key (or EOF)
			i++;
			if (tok.mapItemKey !== undefined) {
				const item: Record<string, unknown> = {};
				if (tok.mapItemValue === "") {
					item[tok.mapItemKey] =
						i < toks.length && toks[i].indent > indent
							? parseBlock(toks[i].indent)
							: true;
				} else {
					const mv = tok.mapItemValue;
					if (mv === undefined) continue; // unreachable: mapItemKey/mapItemValue are co-set
					item[tok.mapItemKey] = parseValue(mv);
				}
				list.push(item);
				// deeper `key: value` lines continue the same map item
				if (i < toks.length && toks[i].indent > indent && "key" in toks[i]) {
					Object.assign(item, parseMap(toks[i].indent));
				}
			} else {
				list.push(parseValue(tok.item));
			}
		}
		return list;
	}

	if (toks.length === 0) return {};
	return parseBlock(toks[0].indent) as Record<string, unknown>;
}
