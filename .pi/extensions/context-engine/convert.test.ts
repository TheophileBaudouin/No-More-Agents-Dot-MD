import { test } from "node:test";
import assert from "node:assert/strict";
import { assignNames, parseSections, slugify } from "./convert.ts";

test("parseSections: splits on ATX headings, keeps original line numbers", () => {
	const raw = [
		"# Setup",
		"Run setup first.",
		"",
		"## Tests",
		"npm test",
	].join("\n");
	const sections = parseSections(raw);
	assert.equal(sections.length, 2);
	assert.deepEqual(
		sections.map((s) => [s.title, s.level, s.startLine, s.endLine]),
		[
			["Setup", 1, 1, 3],
			["Tests", 2, 4, 5],
		],
	);
	assert.deepEqual(sections[0].lines, ["Run setup first.", ""]);
	assert.deepEqual(sections[1].lines, ["npm test"]);
});

test("parseSections: headings inside fenced code blocks are not headings", () => {
	const raw = [
		"# Build",
		"```bash",
		"# not a heading",
		"npm run build",
		"```",
		"## Deploy",
		"ship it",
	].join("\n");
	const sections = parseSections(raw);
	assert.equal(sections.length, 2);
	assert.deepEqual(sections[0].lines, ["```bash", "# not a heading", "npm run build", "```"]);
	assert.equal(sections[1].title, "Deploy");
});

test("parseSections: tilde fences are tracked too", () => {
	const raw = ["# A", "~~~", "# still code", "~~~", "## B", "x"].join("\n");
	const sections = parseSections(raw);
	assert.deepEqual(sections.map((s) => s.title), ["A", "B"]);
});

test("parseSections: preamble before the first heading becomes an Overview section", () => {
	const raw = ["Welcome to my project.", "This line matters.", "", "## Conventions", "use tabs"].join("\n");
	const sections = parseSections(raw);
	assert.equal(sections.length, 2);
	assert.equal(sections[0].title, "Overview");
	assert.equal(sections[0].level, 0);
	assert.equal(sections[0].startLine, 1);
	assert.deepEqual(sections[0].lines, ["Welcome to my project.", "This line matters.", ""]);
});

test("parseSections: file without headings is one Overview section", () => {
	const sections = parseSections("Just a wall of text.\n");
	assert.equal(sections.length, 1);
	assert.equal(sections[0].title, "Overview");
	// trailing "" comes from the final newline — bodies keep source lines verbatim
	assert.deepEqual(sections[0].lines, ["Just a wall of text.", ""]);
});

test("parseSections: leading frontmatter is skipped but line numbers stay absolute", () => {
	const raw = ["---", "title: x", "---", "", "# Setup", "Run setup.", "## Tests", "npm test"].join("\n");
	const sections = parseSections(raw);
	assert.equal(sections.length, 2);
	assert.equal(sections[0].startLine, 5);
	assert.equal(sections[1].startLine, 7);
});

test("parseSections: CRLF input works", () => {
	const sections = parseSections("# A\r\nbody\r\n\r\n## B\r\nx\r\n");
	assert.equal(sections.length, 2);
	assert.deepEqual(sections[0].lines, ["body", ""]);
});

test("parseSections: empty or frontmatter-only input yields no sections", () => {
	assert.deepEqual(parseSections(""), []);
	assert.deepEqual(parseSections("---\ntitle: x\n---\n"), []);
});

test("parseSections: heading-only sections (no body) are dropped", () => {
	const raw = ["# A", "## B", "body of b"].join("\n");
	const sections = parseSections(raw);
	assert.equal(sections.length, 1);
	assert.equal(sections[0].title, "B");
});

test("slugify: kebab-case, diacritics folded, symbols dashed", () => {
	assert.equal(slugify("Build & Test"), "build-test");
	assert.equal(slugify("CI/CD pipeline"), "ci-cd-pipeline");
	assert.equal(slugify("Émotions & accents"), "emotions-accents");
	assert.equal(slugify("  --Weird__title!!  "), "weird-title");
});

test("slugify: truncates to 48 chars and never ends with a dash", () => {
	const long = slugify("a".repeat(60) + "-tail");
	assert.ok(long.length <= 48);
	assert.ok(!long.endsWith("-"));
});

test("slugify: empty or symbol-only titles fall back to 'section'", () => {
	assert.equal(slugify(""), "section");
	assert.equal(slugify("---"), "section");
	assert.equal(slugify("###"), "section");
});

test("assignNames: dedupes among sections and against existing rule names", () => {
	const sections = parseSections("# Git safety\nx\n\n# Git safety\ny\n\n# Testing\nz");
	const named = assignNames(sections, ["git-safety"]);
	assert.deepEqual(
		named.map((n) => n.name),
		["git-safety-2", "git-safety-3", "testing"],
	);
});

test("assignNames: existing names are matched case-insensitively", () => {
	const sections = parseSections("# Testing\nx");
	const named = assignNames(sections, ["Testing"]);
	assert.equal(named[0].name, "testing-2");
});
