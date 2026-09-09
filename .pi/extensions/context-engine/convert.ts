// convert.ts — /nma convert support: split an AGENTS.md-style source into
// sections, suggest unique kebab rule names, and build the plan (transcript
// block) and the brief (agent message). Pure functions only — no pi imports,
// no fs. index.ts owns all I/O; this module stays testable like registry.ts.

export type ConvertSection = {
	title: string;
	level: number; // heading level; 0 = preamble / file without headings
	startLine: number; // 1-based, first line of the section in the source
	endLine: number; // 1-based, last line of the section in the source
	lines: string[];
};

export type NamedSection = {
	section: ConvertSection;
	name: string; // suggested rule/file name, unique
};

const ATX_HEADING_RE = /^#{1,6}\s+(.*)$/;

/** True while `line` closes the currently open ``` / ~~~ fence. */
function isClosingFence(line: string, state: string): boolean {
	const t = line.trim();
	if (!t.startsWith(state)) return false;
	return t.split("").every((c) => c === state);
}

export function parseSections(raw: string): ConvertSection[] {
	const lines = raw.split(/\r?\n/);
	// Skip a leading frontmatter block (--- ... ---) but keep the original
	// line numbering — plan/brief line ranges reference the real file.
	let start = 0;
	if (lines[0] !== undefined && /^---\s*$/.test(lines[0])) {
		for (let i = 1; i < lines.length; i++) {
			if (/^---\s*$/.test(lines[i])) {
				start = i + 1;
				break;
			}
		}
	}
	const sections: ConvertSection[] = [];
	let preamble: string[] = [];
	let sawHeading = false;
	let current: ConvertSection | null = null;
	let fence: string | null = null;
	for (let i = start; i < lines.length; i++) {
		const lineNo = i + 1;
		const line = lines[i];
		const wasOpen = fence !== null;
		fence =
			fence === null
				? (/^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]?.[0] ?? null)
				: isClosingFence(line, fence)
					? null
					: fence;
		const m = !wasOpen && fence === null ? ATX_HEADING_RE.exec(line) : null;
		if (m) {
			if (current) {
				current.endLine = lineNo - 1;
			} else if (preamble.some((l) => l.trim() !== "")) {
				sections.push({
					title: "Overview",
					level: 0,
					startLine: start + 1,
					endLine: lineNo - 1,
					lines: preamble,
				});
			}
			preamble = [];
			sawHeading = true;
			current = {
				title: m[1].trim(),
				level: m[0].match(/^#+/)![0].length,
				startLine: lineNo,
				endLine: lineNo,
				lines: [],
			};
			sections.push(current);
			continue;
		}
		if (current) current.lines.push(line);
		else preamble.push(line);
	}
	if (current) {
		current.endLine = lines.length;
	} else if (!sawHeading && preamble.some((l) => l.trim() !== "")) {
		sections.push({
			title: "Overview",
			level: 0,
			startLine: start + 1,
			endLine: lines.length,
			lines: preamble,
		});
	}
	return sections.filter((s) => s.lines.join("").trim() !== "");
}

/** Kebab-case slug from a section title (ASCII-folded, ≤48 chars). */
export function slugify(title: string): string {
	const slug = title
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)
		.replace(/-+$/g, "");
	return slug === "" ? "section" : slug;
}

/** Suggest a unique <name>.md stem per section, deduped against the
 * existing rule names (case-insensitive) and among the sections. */
export function assignNames(
	sections: ConvertSection[],
	existing: string[] = [],
): NamedSection[] {
	const taken = new Set(existing.map((n) => n.toLowerCase()));
	return sections.map((section) => {
		const base = slugify(section.title);
		let name = base;
		let n = 2;
		while (taken.has(name)) name = `${base}-${n++}`;
		taken.add(name);
		return { section, name };
	});
}

function lineRange(s: ConvertSection): string {
	return s.startLine === s.endLine
		? `l. ${s.startLine}`
		: `l. ${s.startLine}–${s.endLine}`;
}

/** Human-readable plan block (transcript, via pi.sendMessage). */
export function buildPlan(input: {
	sourceRel: string;
	targetDir: string;
	named: NamedSection[];
	existing: string[];
	yesFlag: boolean;
}): string {
	const out: string[] = [];
	out.push(`**/nma convert — plan**`, ``);
	out.push(`**Source:** ${input.sourceRel} — ${input.named.length} section(s)`);
	out.push(
		`**Target:** \`${input.targetDir}/\` — ${input.existing.length} existing rule file(s)`,
	);
	out.push(
		input.yesFlag
			? `**Overwrite policy:** \`--yes\` — overwriting existing rule files is pre-approved`
			: `**Overwrite policy:** the agent asks before overwriting an existing rule file (or rerun with \`--yes\`)`,
	);
	out.push(``);
	out.push(`| # | Suggested rule name | Source section |`);
	out.push(`| --- | --- | --- |`);
	input.named.forEach((n, i) => {
		out.push(
			`| ${i + 1} | \`${n.name}\` | "${n.section.title}" (${lineRange(n.section)}) |`,
		);
	});
	if (input.existing.length > 0) {
		out.push(``);
		out.push(
			`Existing rule names: ${input.existing.map((n) => `\`${n}\``).join(", ")}`,
		);
	}
	out.push(``);
	out.push(
		`**Note:** the source stays auto-loaded by pi (context files load once at startup) until it is neutralized — see the follow-up in the brief.`,
	);
	return out.join("\n");
}

/** Agent-facing brief (via pi.sendUserMessage — always triggers a turn). */
export function buildBrief(input: {
	sourceRel: string;
	named: NamedSection[];
	existing: string[];
	yesFlag: boolean;
}): string {
	const out: string[] = [];
	out.push(
		`Convert \`${input.sourceRel}\` into atomic, event-driven rule files in \`.pi/context/\`, following the **no-more-agents-dot-md** skill (read its SKILL.md first; consult \`templates/\` and \`references/\` — schema.md, events.md, matching.md, actions.md — as needed).`,
	);
	out.push(``);
	out.push(`## Sections to convert (${input.named.length})`);
	out.push(``);
	input.named.forEach((n, i) => {
		const s = n.section;
		const range =
			s.startLine === s.endLine
				? `line ${s.startLine}`
				: `lines ${s.startLine}–${s.endLine}`;
		out.push(
			`${i + 1}. \`${n.name}\` — "${s.title}" (${range}, heading level ${s.level})`,
		);
	});
	out.push(``);
	out.push(`## What to do`);
	out.push(``);
	out.push(`1. Read \`${input.sourceRel}\` in full.`);
	out.push(
		`2. For each section, classify its content and emit ONE OR MORE atomic rule files — one topic per file; split a section further when it mixes topics. Suggested names above are unique against existing rules; you may refine them (kebab-case) as long as they stay unique.`,
	);
	out.push(
		`3. Classification guide (the skill's decision tree has the details):`,
	);
	out.push(
		`   - Conventions / standing instructions → \`before_agent_start\` + \`inject\`; add \`once: true\` for session-level conventions; add \`match: {input: {contains: [...]}}\` when the guidance only matters for a topic.`,
	);
	out.push(
		`   - Forbidden or dangerous shell commands → \`tool_call\` + \`block\` or \`confirm\`, mirrored on \`user_bash\` for hand-typed commands; \`priority: high\`, empty body, regexes anchored with \`^\`, each ≤ 200 chars, no nested quantifiers.`,
	);
	out.push(
		`   - Guidance relevant only around a tool or its output → \`tool_call\` or \`tool_result\` + \`inject\` (optionally \`once: true\`), matching \`tool\` / \`command\` / \`result\`.`,
	);
	out.push(
		`   - Pure visual feedback → \`notify\`. Facts, links, roadmap, anything the agent would do anyway → DROP it (no rule).`,
	);
	out.push(`4. Hard constraints (a file violating these fails to load):`);
	out.push(
		`   - Flat file \`.pi/context/<name>.md\`; file name = rule \`name\`; all names unique; never \`README.md\`.`,
	);
	out.push(
		`   - File skeleton: line 1 is exactly \`---\`, the frontmatter follows, then a closing line \`---\`, then the body — a file that does not START with the \`---\` line is silently ignored as inert documentation.`,
	);
	out.push(
		`   - YAML-subset frontmatter only (between the two \`---\` lines): \`key: value\`, inline \`[a, b]\`, inline maps, 2-space nesting; \`name\`, non-empty \`events\`, and \`action.type\` required; \`action.type\` must be allowed for EVERY listed event.`,
	);
	out.push(
		`   - Bodies carry context only — minimal, behavior-changing facts; frontmatter never reaches the model.`,
	);
	out.push(
		`   - Plain Markdown bodies: no external URLs, no base64/hex blobs, no prompt-injection phrasing (the security scan blocks or distrusts such files).`,
	);
	out.push(
		input.yesFlag
			? `5. Overwriting an existing rule file is pre-approved (\`--yes\`); still list every overwrite in your summary.`
			: `5. Never overwrite an existing rule file without asking the user first; prefer a fresh name.`,
	);
	out.push(`6. Do not modify or delete \`${input.sourceRel}\`.`);
	out.push(
		`7. When done, report one line per file written (\`name\` — events — action.type), then remind the user to run \`/nma reload\` and verify with \`/nma\`. Also warn the user that \`${input.sourceRel}\` is still auto-loaded by pi (once at startup) — the conversion only reduces context noise once they neutralize the source.`,
	);
	return out.join("\n");
}
