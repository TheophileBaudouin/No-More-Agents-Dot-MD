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
		fence = fence === null
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
