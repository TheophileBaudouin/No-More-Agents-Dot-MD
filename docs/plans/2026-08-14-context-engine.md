# Context Engine for Pi — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a tiny declarative layer — a Pi extension + a skill — that turns `.pi/context/*.md` files into dynamic behaviors: conditional context injection, tool guards, confirmations, and post-tool guidance, replacing the monolithic AGENTS.md with micro-contexts.

**Architecture:** A Pi extension (`context-engine`) scans `.pi/context/*.md` at `session_start`, parses each file's YAML frontmatter (behavior: events/match/action) and treats the Markdown body as the injectable context. The extension subscribes to `before_agent_start` (conditional system-prompt injection, gated on the user prompt), `tool_call` (block / confirm / modify / queue guidance), and `context` (deliver queued guidance before the next LLM call). All matching and parsing logic lives in pure modules unit-tested with `node --test` (native TS type-stripping, zero npm dependencies). The shipped skill is deliberately tiny: SKILL.md points to 6 one-screen templates + 6 reference docs, so the model never has to memorize the API.

**Tech Stack:** TypeScript (Node ≥ 22.6 native type-stripping, verified on v23.11.0), Pi extension SDK (`@earendil-works/pi-coding-agent` — types only, erased at runtime), `node --test` + `node:assert/strict` for tests, no npm dependencies anywhere.

**Key SDK facts verified against pi docs (`docs/extensions.md`):**

- Project-local extensions: `.pi/extensions/*/index.ts` (loads after project trust).
- `before_agent_start`: `event.prompt` (user text), return `{ systemPrompt }` to append. Handlers chain across extensions.
- `tool_call`: `event.toolName`, `event.input` (mutable in place), return `{ block: true, reason, terminate }` to block, `ctx.ui.confirm(title, msg) → boolean`, `ctx.hasUI` guard.
- `context`: fires before each LLM call; return `{ messages }` (deep-copied, safe to modify).
- `session_start`: gives `ctx.cwd` (project root).
- Skills live in `.pi/skills/<name>/SKILL.md` (project) or `~/.pi/agent/skills/<name>/SKILL.md` (global).
- Test command that works on this machine: `node --test "*.test.ts"` (directory auto-discovery does NOT include `.ts`).

**Schema (v1) — the contract between .md files and the engine:**

```yaml
---
name: ui-context              # required, unique
description: ...              # recommended, used in confirm/block reasons
events: [before_agent_start]  # required: before_agent_start | tool_call
match:                        # optional; absent = always matches
  input: {contains: [ui, ux]} # against user prompt (before_agent_start) or tool input JSON (tool_call)
  command: {regex: ["^git push"]}  # against input.command for bash-like tools (tool_call)
  tool: bash                  # tool name (tool_call)
  any: [ {...}, {...} ]       # OR across sub-specs; wins if any sub matches
action:
  type: inject | confirm | block | modify
  once: true                  # inject only: once per session
  message: "..."              # confirm/block: shown to user or used as block reason
  command: {append: " 2>&1"}  # modify only: patch bash command
priority: high | normal | low # default normal; high=3, normal=2, low=1, desc sort
---
```

- Guard rules (`confirm`/`block`) need no Markdown body; the frontmatter does the work.
- Files without frontmatter (e.g. `README.md`) are inert documentation.
- The frontmatter is never injected; only the Markdown body is.

**Deliberate v1 exclusions (ask before expanding):**

- `input` event (transform/handled) — `before_agent_start` covers prompt matching; add when a real transform need appears.
- `tool_result` reactions — deferred; the `context`-event queue covers the useful "guidance after a tool ran" case.
- `action.position` — only system-prompt injection exists; the field is ignored (unknown keys are tolerated, so existing examples still parse).
- File watching — rules reload per `session_start`; restart pi after editing a rule.

---

## Task 1: Scaffold the repository

**Files:**

- Create: `.gitignore`
- Create: `README.md` (stub)
- Create: `.pi/context/README.md` (placeholder)
- Create: `.pi/extensions/context-engine/` (empty dir via `.gitkeep` if needed)

**Step 1: Init git and create directories**

```bash
git init
mkdir -p ".pi/context" ".pi/extensions/context-engine" docs/plans
```

**Step 2: Create `.gitignore`**

```gitignore
node_modules/
.DS_Store
```

**Step 3: Create `README.md` stub**

```markdown
# no-agents dot md

Replaces the monolithic `AGENTS.md` with tiny declarative context files
(`.pi/context/*.md`) driven by a Pi extension. See docs/plans/2026-08-14-context-engine.md.
```

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold repo layout"
```

---

## Task 2: Frontmatter parser (pure, TDD)

A dependency-free YAML-subset parser. Supports exactly what the schema needs: flat pairs, inline lists `[a, b]`, block lists (`- item`), inline maps `{a: 1, b: 2}`, and 2-space-indented nesting. Errors loudly on anything else.

```text
ponytail: YAML subset on purpose — switch to the `yaml` npm package only when
frontmatter complexity outgrows this (needs package.json + npm install in the
extension dir).
```

**Files:**

- Create: `.pi/extensions/context-engine/frontmatter.ts`
- Create: `.pi/extensions/context-engine/frontmatter.test.ts`

**Step 1: Write the failing test**

`.pi/extensions/context-engine/frontmatter.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYamlSubset } from "./frontmatter.ts";

test("parses flat key-value pairs and inline lists", () => {
 assert.deepEqual(
  parseYamlSubset("name: ui-context\ndescription: Conventions UI\nevents: [before_agent_start]"),
  { name: "ui-context", description: "Conventions UI", events: ["before_agent_start"] },
 );
});

test("parses nested maps with block lists", () => {
 const out = parseYamlSubset(`match:
  tool: bash
  command:
    regex:
      - "^git push"
      - "^git reset --hard"`);
 assert.deepEqual(out, {
  match: { tool: "bash", command: { regex: ["^git push", "^git reset --hard"] } },
 });
});

test("parses a list of maps (match.any)", () => {
 const out = parseYamlSubset(`match:
  any:
    - input:
        contains: [test]
    - tool: bash`);
 assert.deepEqual(out, {
  match: { any: [{ input: { contains: ["test"] } }, { tool: "bash" }] },
 });
});

test("parses inline maps", () => {
 assert.deepEqual(parseYamlSubset("match:\n  input: {contains: [ui, ux]}"), {
  match: { input: { contains: ["ui", "ux"] } },
 });
});

test("parses booleans, quoted strings, bare flags", () => {
 assert.deepEqual(
  parseYamlSubset('once: true\npriority: normal\nmessage: "git push"\nnotes: '),
  { once: true, priority: "normal", message: "git push", notes: true },
 );
});

test("comments and empty lines are ignored", () => {
 assert.deepEqual(parseYamlSubset("# header comment\n\nname: x\n"), { name: "x" });
});

test("rejects lines without a colon", () => {
 assert.throws(() => parseYamlSubset("this line has no colon"));
});

test("returns empty object for empty input", () => {
 assert.deepEqual(parseYamlSubset(""), {});
});
```

**Step 2: Run the test to verify it fails**

Run: `cd .pi/extensions/context-engine && node --test frontmatter.test.ts`
Expected: FAIL — `Cannot find module './frontmatter.ts'`.

**Step 3: Write the minimal implementation**

`.pi/extensions/context-engine/frontmatter.ts`:

```typescript
/**
 * Minimal YAML-subset parser for context-file frontmatter.
 * Supports: `key: value`, inline lists `[a, b]`, inline maps `{a: 1}`,
 * block lists (`- item`), and 2-space-indented nested maps/lists.
 * Not a general YAML parser — throws on anything else.
 */

type Tok =
 | { indent: number; key: string; value: string }
 | { indent: number; item: string; mapItemKey?: string; mapItemValue?: string };

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
   toks.push({ indent, key: t.slice(0, i).trim(), value: t.slice(i + 1).trim() });
  }
 }
 return toks;
}

function parseScalar(v: string): string | number | boolean | null {
 if (
  v.length >= 2 &&
  ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
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
// lists (`{contains: [ui, ux]}`). Naive split(",") would break on commas
// inside bracket values (fixed during Task 2 execution).
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
  return inner === "" ? [] : inner.split(",").map((s) => parseScalar(s.trim()));
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
  return toks[i].key !== undefined ? parseMap(indent) : parseList(indent);
 }

 function parseMap(indent: number): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  while (i < toks.length && toks[i].indent === indent && toks[i].key !== undefined) {
   const tok = toks[i];
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
  while (i < toks.length && toks[i].indent === indent && toks[i].key === undefined) {
   const tok = toks[i];
   i++;
   if (tok.mapItemKey !== undefined) {
    const item: Record<string, unknown> = {};
    if (tok.mapItemValue === "") {
     item[tok.mapItemKey] =
      i < toks.length && toks[i].indent > indent
       ? parseBlock(toks[i].indent)
       : true;
    } else {
     item[tok.mapItemKey] = parseValue(tok.mapItemValue);
    }
    list.push(item);
    // deeper `key: value` lines continue the same map item
    if (i < toks.length && toks[i].indent > indent && toks[i].key !== undefined) {
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
```

**Step 4: Run the test to verify it passes**

Run: `cd .pi/extensions/context-engine && node --test frontmatter.test.ts`
Expected: PASS — 8 tests, 0 fail.

**Step 5: Commit**

```bash
git add .pi/extensions/context-engine
git commit -m "feat: YAML-subset frontmatter parser"
```

---

## Task 3: Match engine (pure, TDD)

**Files:**

- Create: `.pi/extensions/context-engine/match.ts`
- Create: `.pi/extensions/context-engine/match.test.ts`

**Step 1: Write the failing test**

`.pi/extensions/context-engine/match.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRule } from "./match.ts";
import type { Subject } from "./match.ts";

test("no match spec matches everything", () => {
 assert.equal(matchRule(undefined, { text: "anything" }), true);
});

test("input contains is case-insensitive, any-of", () => {
 const m = { input: { contains: ["ui", "ux", "user interface"] } };
 assert.equal(matchRule(m, { text: "FIX THE UI" }), true);
 assert.equal(matchRule(m, { text: "user interface work" }), true);
 assert.equal(matchRule(m, { text: "bump the version" }), false);
});

test("input regex is any-of", () => {
 const m = { input: { regex: ["^git push", "^git reset"] } };
 assert.equal(matchRule(m, { text: "git push origin main" }), true);
 assert.equal(matchRule(m, { text: "git status" }), false);
});

test("tool + command matching on a bash subject", () => {
 const m = { tool: "bash", command: { regex: ["^git push", "^git reset --hard"] } };
 assert.equal(
  matchRule(m, { text: "{}", tool: "bash", command: "git push origin main" }),
  true,
 );
 assert.equal(matchRule(m, { text: "{}", tool: "bash", command: "git status" }), false);
 assert.equal(matchRule(m, { text: "{}", tool: "read", command: "" }), false);
});

test("tool accepts a list of names", () => {
 const m = { tool: ["bash", "git"] };
 assert.equal(matchRule(m, { text: "", tool: "bash", command: "ls" }), true);
 assert.equal(matchRule(m, { text: "", tool: "read" }), false);
});

test("any: OR across sub-specs wins immediately", () => {
 const m = { any: [{ input: { contains: ["test"] } }, { tool: "bash" }] };
 assert.equal(matchRule(m, { text: "write a test" }), true);
 assert.equal(matchRule(m, { text: "x", tool: "bash", command: "ls" }), true);
 assert.equal(matchRule(m, { text: "refactor", tool: "read" }), false);
});

test("plain string input pattern is a substring", () => {
 assert.equal(matchRule({ input: "security" }, { text: "do a security review" }), true);
});
```

**Step 2: Run the test to verify it fails**

Run: `cd .pi/extensions/context-engine && node --test match.test.ts`
Expected: FAIL — `Cannot find module './match.ts'`.

**Step 3: Write the minimal implementation**

`.pi/extensions/context-engine/match.ts`:

```typescript
/** Pure rule matcher. No pi imports — unit-testable with node --test. */

export type Subject = {
 /** Text matched against `input` patterns (prompt text or tool input JSON). */
 text: string;
 /** Tool name, set for tool_call subjects. */
 tool?: string;
 /** String value of `input.command`, set for bash-like tool calls. */
 command?: string;
};

export type MatchSpec = Record<string, unknown>;

function patternList(p: unknown): Array<{ contains: string[]; regex: string[] }> {
 const arr = Array.isArray(p) ? p : [p];
 const out: Array<{ contains: string[]; regex: string[] }> = [];
 for (const entry of arr) {
  if (typeof entry === "string") {
   out.push({ contains: [entry], regex: [] });
  } else if (entry && typeof entry === "object") {
   const e = entry as Record<string, unknown>;
   out.push({
    contains: (Array.isArray(e.contains) ? e.contains : e.contains ? [e.contains] : []).map(String),
    regex: (Array.isArray(e.regex) ? e.regex : e.regex ? [e.regex] : []).map(String),
   });
  }
 }
 return out;
}

/** Any-of semantics: one `contains` substring OR one `regex` must hit. */
function matchPatterns(p: unknown, text: string): boolean {
 const list = patternList(p);
 if (list.length === 0) return false;
 return list.some(
  (pat) =>
   pat.contains.some((s) => text.toLowerCase().includes(s.toLowerCase())) ||
   pat.regex.some((r) => new RegExp(r).test(text)),
 );
}

export function matchRule(m: MatchSpec | undefined, s: Subject): boolean {
 if (!m) return true;

 // `any` is an OR shortcut: any matching sub-spec wins immediately.
 if (Array.isArray(m.any)) {
  if (m.any.some((sub) => sub && typeof sub === "object" && matchRule(sub as MatchSpec, s))) {
   return true;
  }
  // none of the sub-specs matched; only remaining keys can still match
  if (m.tool === undefined && m.input === undefined && m.command === undefined) {
   return false;
  }
 }

 if (m.tool !== undefined) {
  const tools = Array.isArray(m.tool) ? m.tool.map(String) : [String(m.tool)];
  if (!s.tool || !tools.includes(s.tool)) return false;
 }
 if (m.input !== undefined && !matchPatterns(m.input, s.text)) return false;
 if (m.command !== undefined && !matchPatterns(m.command, s.command ?? "")) return false;
 return true;
}
```

**Step 4: Run the test to verify it passes**

Run: `cd .pi/extensions/context-engine && node --test match.test.ts`
Expected: PASS — 7 tests, 0 fail.

**Step 5: Commit**

```bash
git add .pi/extensions/context-engine
git commit -m "feat: declarative rule matcher"
```

---

## Task 4: Rule model + loader (pure, TDD)

**Files:**

- Create: `.pi/extensions/context-engine/engine.ts`
- Create: `.pi/extensions/context-engine/engine.test.ts`

**Step 1: Write the failing test**

`.pi/extensions/context-engine/engine.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseContextFile, loadContextDir, selectInject, selectToolRules } from "./engine.ts";

const UI_RULE = `---
name: ui-context
description: UI conventions
events: [before_agent_start]
match:
  input:
    contains: [ui, ux]
action:
  type: inject
  once: true
---

# UI Conventions
Use existing components before writing new ones.
`;

test("parseContextFile extracts metadata and body", () => {
 const rule = parseContextFile(UI_RULE, "ui.md")!;
 assert.equal(rule.name, "ui-context");
 assert.equal(rule.description, "UI conventions");
 assert.deepEqual(rule.events, ["before_agent_start"]);
 assert.equal(rule.action.type, "inject");
 assert.equal(rule.action.once, true);
 assert.equal(rule.priority, 2); // normal
 assert.match(rule.body, /# UI Conventions/);
});

test("parseContextFile returns null without frontmatter", () => {
 assert.equal(parseContextFile("# Just documentation\n", "README.md"), null);
});

test("parseContextFile throws when name is missing", () => {
 assert.throws(() =>
  parseContextFile("---\nevents: [tool_call]\naction: {type: block}\n---\nbody", "x.md"),
 );
});

test("parseContextFile maps priority strings", () => {
 const high = parseContextFile(UI_RULE.replace("action:", "priority: high\naction:"), "h.md")!;
 const low = parseContextFile(UI_RULE.replace("action:", "priority: low\naction:"), "l.md")!;
 assert.equal(high.priority, 3);
 assert.equal(low.priority, 1);
});

test("loadContextDir reads real files, skips README, sorts by priority", () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-"));
 fs.writeFileSync(path.join(dir, "ui.md"), UI_RULE);
 fs.writeFileSync(path.join(dir, "guard.md"),
  "---\nname: git-safety\nevents: [tool_call]\npriority: high\naction: {type: block}\n---\n");
 fs.writeFileSync(path.join(dir, "README.md"), "# docs");
 const rules = loadContextDir(dir);
 assert.equal(rules.length, 2);
 assert.equal(rules[0].name, "git-safety"); // high priority first
 assert.equal(rules[1].name, "ui-context");
 fs.rmSync(dir, { recursive: true, force: true });
});

test("loadContextDir returns [] for missing dir and tolerates broken files", () => {
 assert.deepEqual(loadContextDir("/nonexistent/xyz"), []);
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-"));
 fs.writeFileSync(path.join(dir, "broken.md"), "---\nnope\n---\nx");
 assert.deepEqual(loadContextDir(dir), []);
 fs.rmSync(dir, { recursive: true, force: true });
});

test("selectInject gates on keyword match and once", () => {
 const rules = [parseContextFile(UI_RULE, "ui.md")!];
 const injected = new Set<string>();
 assert.equal(selectInject(rules, { text: "improve the ui" }, injected).length, 1);
 assert.equal(selectInject(rules, { text: "bump version" }, injected).length, 0);
 // once: marked rules are excluded on later turns
 injected.add("ui-context");
 assert.equal(selectInject(rules, { text: "improve the ui" }, injected).length, 0);
});

test("selectToolRules matches tool_call rules", () => {
 const guard = parseContextFile(
  "---\nname: g\nevents: [tool_call]\nmatch:\n  tool: bash\n  command: {regex: [\"^git push\"]}\naction: {type: confirm}\n---\n",
  "g.md",
 )!;
 const rules = [guard];
 assert.equal(selectToolRules(rules, { text: "{}", tool: "bash", command: "git push" }).length, 1);
 assert.equal(selectToolRules(rules, { text: "{}", tool: "bash", command: "ls" }).length, 0);
});
```

**Step 2: Run the test to verify it fails**

Run: `cd .pi/extensions/context-engine && node --test engine.test.ts`
Expected: FAIL — `Cannot find module './engine.ts'`.

**Step 3: Write the minimal implementation**

`.pi/extensions/context-engine/engine.ts`:

```typescript
/** Rule model, loader, and pure selection helpers. No pi imports. */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseYamlSubset } from "./frontmatter.ts";
import { matchRule, type Subject } from "./match.ts";

export type RuleAction = {
 type: "inject" | "confirm" | "block" | "modify";
 once?: boolean;
 message?: string;
 command?: { append?: string; prepend?: string };
};

export type Rule = {
 name: string;
 description: string;
 events: string[];
 match?: Record<string, unknown>;
 action: RuleAction;
 priority: number; // 3 high, 2 normal, 1 low
 body: string;
 file: string;
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseContextFile(raw: string, file: string): Rule | null {
 const m = raw.match(FRONTMATTER_RE);
 if (!m) return null; // no frontmatter → inert documentation
 const meta = parseYamlSubset(m[1]);
 const name = meta.name;
 if (typeof name !== "string" || !name) throw new Error(`missing "name"`);
 const events = meta.events;
 if (!Array.isArray(events) || events.length === 0) {
  throw new Error(`"events" must be a non-empty list`);
 }
 const action = meta.action as RuleAction | undefined;
 if (!action || typeof action !== "object" || typeof action.type !== "string") {
  throw new Error(`missing "action.type"`);
 }
 return {
  name,
  description: typeof meta.description === "string" ? meta.description : "",
  events: events.map(String),
  match: (meta.match as Record<string, unknown> | undefined) ?? undefined,
  action,
  priority: meta.priority === "high" ? 3 : meta.priority === "low" ? 1 : 2,
  body: raw.slice(m[0].length).trim(),
  file,
 };
}

export function sortRules(rules: Rule[]): Rule[] {
 return [...rules].sort((a, b) => b.priority - a.priority);
}

/** Load rules from a .pi/context directory (non-recursive; README.md skipped). */
export function loadContextDir(dir: string): Rule[] {
 if (!fs.existsSync(dir)) return [];
 const files = fs.readdirSync(dir).filter(
  (f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md",
 );
 const rules: Rule[] = [];
 for (const f of files) {
  try {
   const rule = parseContextFile(fs.readFileSync(path.join(dir, f), "utf8"), f);
   if (rule) rules.push(rule);
  } catch (e) {
   console.error(`[context-engine] ${f}: ${(e as Error).message}`);
  }
 }
 return sortRules(rules);
}

/** Pure selection for before_agent_start injection. */
export function selectInject(rules: Rule[], subject: Subject, injectedOnce: Set<string>): Rule[] {
 return rules.filter(
  (r) =>
   r.events.includes("before_agent_start") &&
   r.action.type === "inject" &&
   (!r.action.once || !injectedOnce.has(r.name)) &&
   matchRule(r.match, subject),
 );
}

/** Pure selection for tool_call (all action types; priority order preserved). */
export function selectToolRules(rules: Rule[], subject: Subject): Rule[] {
 return rules.filter((r) => r.events.includes("tool_call") && matchRule(r.match, subject));
}
```

**Step 4: Run the test to verify it passes**

Run: `cd .pi/extensions/context-engine && node --test engine.test.ts`
Expected: PASS — 8 tests, 0 fail.

**Step 5: Run the full suite, then commit**

Run: `cd .pi/extensions/context-engine && node --test "*.test.ts"`
Expected: PASS — 23 tests, 0 fail.

```bash
git add .pi/extensions/context-engine
git commit -m "feat: rule model, loader, and selection helpers"
```

---

## Task 5: Extension wiring (fake-pi harness test)

The event handlers themselves. `index.ts` imports pi types only (erased at runtime), so we can unit-test the wiring against a fake `pi` object under `node --test`.

**Files:**

- Create: `.pi/extensions/context-engine/index.ts`
- Create: `.pi/extensions/context-engine/index.test.ts`

**Step 1: Write the failing test**

`.pi/extensions/context-engine/index.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import createExtension from "./index.ts";

type Handler = (event: any, ctx: any) => unknown;
type FakePi = { on: (ev: string, h: Handler) => void; handlers: Record<string, Handler> };

function makePi(): FakePi {
 const handlers: Record<string, Handler> = {};
 return {
  handlers,
  on: (ev: string, h: Handler) => void (handlers[ev] = h),
 };
}

function makeProject(files: Record<string, string>): string {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proj-"));
 for (const [rel, content] of Object.entries(files)) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
 }
 return dir;
}

const UI_RULE = `---
name: ui-context
description: UI conventions
events: [before_agent_start]
match:
  input: {contains: [ui, ux]}
action:
  type: inject
  once: true
---

# UI Conventions
Use existing components.
`;

const GIT_GUARD = `---
name: git-safety
description: Confirm destructive git commands
events: [tool_call]
match:
  tool: bash
  command: {regex: ["^git push", "^git reset --hard"]}
action:
  type: confirm
  message: "Commande Git potentiellement destructive."
priority: high
---
`;

const TOOL_CONTEXT = `---
name: test-context
description: Testing conventions after a test command runs
events: [tool_call]
match:
  tool: bash
  command: {contains: ["pytest", "vitest", "go test"]}
action:
  type: inject
  once: true
---

# Testing
Run the focused test file, not the whole suite.
`;

test("before_agent_start injects matched context into the system prompt", async () => {
 const pi = makePi();
 createExtension(pi as any);
 const cwd = makeProject({ ".pi/context/ui.md": UI_RULE });
 await pi.handlers["session_start"]({}, { cwd });

 const res = await pi.handlers["before_agent_start"]({
  prompt: "fix the ui layout",
  systemPrompt: "base",
 });
 assert.match(res.systemPrompt, /# UI Conventions/);
 assert.match(res.systemPrompt, /Use existing components/);
 assert.ok(res.systemPrompt.startsWith("base"));

 // unmatched prompt → no injection
 const res2 = await pi.handlers["before_agent_start"]({
  prompt: "bump the version",
  systemPrompt: "base",
 });
 assert.equal(res2, undefined);

 fs.rmSync(cwd, { recursive: true, force: true });
});

test("once: true injects only on the first matching turn", async () => {
 const pi = makePi();
 createExtension(pi as any);
 const cwd = makeProject({ ".pi/context/ui.md": UI_RULE });
 await pi.handlers["session_start"]({}, { cwd });

 await pi.handlers["before_agent_start"]({ prompt: "fix the ui", systemPrompt: "b" });
 const res2 = await pi.handlers["before_agent_start"]({ prompt: "fix the ui", systemPrompt: "b" });
 assert.equal(res2, undefined);

 fs.rmSync(cwd, { recursive: true, force: true });
});

test("tool_call confirm blocks when declined, passes when approved", async () => {
 const pi = makePi();
 createExtension(pi as any);
 const cwd = makeProject({ ".pi/context/git-safety.md": GIT_GUARD });
 await pi.handlers["session_start"]({}, { cwd });

 const decline = await pi.handlers["tool_call"](
  { toolName: "bash", input: { command: "git push origin main" } },
  { hasUI: true, ui: { confirm: async () => false } },
 );
 assert.deepEqual(decline, { block: true, reason: "Blocked by rule git-safety" });

 const approve = await pi.handlers["tool_call"](
  { toolName: "bash", input: { command: "git push origin main" } },
  { hasUI: true, ui: { confirm: async () => true } },
 );
 assert.equal(approve, undefined); // not blocked

 fs.rmSync(cwd, { recursive: true, force: true });
});

test("tool_call confirm fails safe without UI", async () => {
 const pi = makePi();
 createExtension(pi as any);
 const cwd = makeProject({ ".pi/context/git-safety.md": GIT_GUARD });
 await pi.handlers["session_start"]({}, { cwd });

 const res = await pi.handlers["tool_call"](
  { toolName: "bash", input: { command: "git push origin main" } },
  { hasUI: false },
 );
 assert.equal(res.block, true);

 fs.rmSync(cwd, { recursive: true, force: true });
});

test("tool_call inject queues guidance delivered at the next context event", async () => {
 const pi = makePi();
 createExtension(pi as any);
 const cwd = makeProject({ ".pi/context/test-context.md": TOOL_CONTEXT });
 await pi.handlers["session_start"]({}, { cwd });

 await pi.handlers["tool_call"]({ toolName: "bash", input: { command: "pytest -x" } }, {});
 const res = await pi.handlers["context"]({ messages: [{ role: "user", content: "hi" }] });
 assert.equal(res.messages.length, 2);
 assert.equal(res.messages[1].role, "system");
 assert.match(res.messages[1].content, /# Testing/);

 // queue is drained — next context event is untouched
 const res2 = await pi.handlers["context"]({ messages: [{ role: "user", content: "hi" }] });
 assert.equal(res2, undefined);

 fs.rmSync(cwd, { recursive: true, force: true });
});

test("tool_call block hard-blocks a matched command", async () => {
 const pi = makePi();
 createExtension(pi as any);
 const cwd = makeProject({
  ".pi/context/block.md": `---
name: never-ls
events: [tool_call]
match:
  tool: bash
  command: {regex: ["^ls"]}
action:
  type: block
  message: "ls is banned"
---
`,
 });
 await pi.handlers["session_start"]({}, { cwd });

 const res = await pi.handlers["tool_call"](
  { toolName: "bash", input: { command: "ls -la" } },
  { hasUI: true, ui: { confirm: async () => true } },
 );
 assert.deepEqual(res, { block: true, reason: "ls is banned" });

 fs.rmSync(cwd, { recursive: true, force: true });
});
```

**Step 2: Run the test to verify it fails**

Run: `cd .pi/extensions/context-engine && node --test index.test.ts`
Expected: FAIL — `Cannot find module './index.ts'`.

**Step 3: Write the minimal implementation**

`.pi/extensions/context-engine/index.ts`:

```typescript
/**
 * Context Engine — turns `.pi/context/*.md` files into Pi behaviors.
 * Frontmatter YAML = behavior (events/match/action); the Markdown body is the
 * context injected into the agent. The frontmatter is never injected.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadContextDir, selectInject, selectToolRules, type Rule } from "./engine.ts";
import type { Subject } from "./match.ts";

const CONTEXT_DIR = ".pi/context";

export default function (pi: ExtensionAPI) {
 let rules: Rule[] = [];
 let injectedOnce = new Set<string>();
 let pendingInject: string[] = [];

 function reload(cwd: string) {
  rules = loadContextDir(path.join(cwd, CONTEXT_DIR));
  injectedOnce = new Set<string>();
  pendingInject = [];
  if (rules.length > 0) {
   console.log(`[context-engine] ${rules.length} rule(s) loaded from .pi/context/`);
  }
 }

 pi.on("session_start", async (_event, ctx: ExtensionContext) => reload(ctx.cwd));

 function toolSubject(event: { toolName: string; input?: unknown }): Subject {
  const input = (event.input ?? {}) as Record<string, unknown>;
  return {
   text: JSON.stringify(input),
   tool: event.toolName,
   command: typeof input.command === "string" ? input.command : "",
  };
 }

 // Conditional context injection at agent start (gated on the user prompt).
 pi.on("before_agent_start", async (event) => {
  const subject: Subject = { text: event.prompt ?? "" };
  const chunks = selectInject(rules, subject, injectedOnce);
  if (chunks.length === 0) return;
  for (const r of chunks) if (r.action.once) injectedOnce.add(r.name);
  const injected = chunks.map((r) => `## ${r.name}\n\n${r.body}`).join("\n\n");
  return { systemPrompt: event.systemPrompt + "\n\n" + injected };
 });

 // Tool guards: block, confirm, modify, and deferred context injection.
 pi.on("tool_call", async (event, ctx) => {
  const subject = toolSubject(event);

  for (const r of selectToolRules(rules, subject)) {
   switch (r.action.type) {
    case "block":
     return { block: true, reason: r.action.message ?? r.description ?? r.name };
    case "confirm": {
     const reason = r.action.message ?? `Authorize ${event.toolName}? (rule ${r.name})`;
     if (!ctx.hasUI) return { block: true, reason }; // fail-safe without UI
     const ok = await ctx.ui.confirm(r.name, reason);
     if (!ok) return { block: true, reason: `Blocked by rule ${r.name}` };
     break;
    }
    case "modify": {
     const c = r.action.command;
     const input = event.input as { command?: string } | undefined;
     if (c && input && typeof input.command === "string") {
      if (c.prepend) input.command = c.prepend + input.command;
      if (c.append) input.command = input.command + c.append;
     }
     break;
    }
    case "inject": {
     if (r.action.once && injectedOnce.has(r.name)) break;
     if (r.action.once) injectedOnce.add(r.name);
     pendingInject.push(`## ${r.name}\n\n${r.body}`);
     break;
    }
   }
  }
 });

 // Deliver pending tool-context guidance before the next LLM call.
 pi.on("context", async (event) => {
  if (pendingInject.length === 0) return;
  const text = pendingInject.join("\n\n");
  pendingInject = [];
  return { messages: [...event.messages, { role: "system", content: text }] };
 });
}
```

**Step 4: Run the test to verify it passes**

Run: `cd .pi/extensions/context-engine && node --test index.test.ts`
Expected: PASS — 6 tests, 0 fail.

**Step 5: Run the full suite, then commit**

Run: `cd .pi/extensions/context-engine && node --test "*.test.ts"`
Expected: PASS — 29 tests, 0 fail.

```bash
git add .pi/extensions/context-engine
git commit -m "feat: wire context engine into pi extension events"
```

---

## Task 6: Example context files

Working examples that double as documentation. `README.md` in the context dir is inert (no frontmatter) but explains the format.

**Files:**

- Create: `.pi/context/ui.md`
- Create: `.pi/context/git-safety.md`
- Create: `.pi/context/test-context.md`
- Create: `.pi/context/README.md`

**Step 1: Create the files**

`.pi/context/ui.md`:

```markdown
---
name: ui-context
description: Conventions UI, injected when the prompt mentions UI/UX
events: [before_agent_start]
match:
  input:
    contains: [ui, ux, "interface utilisateur", "user interface"]
action:
  type: inject
  once: true
---

# UI Conventions

- Use the existing components in `src/lib/components/` before writing new ones.
- Prefer Svelte 5 runes ($state, $derived) over legacy reactive statements.
- French UI strings, English code identifiers.
```

`.pi/context/git-safety.md` (guard rules need no body — frontmatter does the work):

```markdown
---
name: git-safety
description: Confirme avant les commandes git destructives
events: [tool_call]
match:
  tool: bash
  command:
    regex: ["^git push", "^git reset --hard", "^git push --force"]
action:
  type: confirm
  message: "Commande Git potentiellement destructive."
priority: high
---
```

`.pi/context/test-context.md` (guidance delivered right after a test command runs):

```markdown
---
name: test-context
description: Conventions de test, injectées après une commande de test
events: [tool_call]
match:
  tool: bash
  command:
    contains: ["pytest", "vitest", "go test"]
action:
  type: inject
  once: true
---

# Testing

- Run the focused test file (`pytest tests/x.py::test_name`), not the whole suite.
- Prefer `assert`-based checks over test doubles; add a test for every fix.
```

`.pi/context/README.md`:

```markdown
# .pi/context

Chaque fichier `*.md` est une règle de comportement pour l'extension `context-engine` :

- Le **frontmatter YAML** décrit le comportement (`events`, `match`, `action`).
- Le **corps Markdown** est le contexte injecté à l'agent. Il n'est jamais montré autrement.
- Un fichier sans frontmatter (comme celui-ci) est de la documentation inerte.

Les règles sont chargées au `session_start` : redémarrez pi après une modification.

Référence complète : `~/.pi/agent/skills/context-engine/references/` (après installation du skill).
```

**Step 2: Verify all tests still pass**

Run: `cd .pi/extensions/context-engine && node --test "*.test.ts"`
Expected: PASS — 29 tests, 0 fail (the rules use `{contains: [...]}` block lists — covered by parser tests).

**Step 3: Commit**

```bash
git add .pi/context
git commit -m "docs: example context rules (ui, git-safety, test-context)"
```

---

## Task 7: Skill — SKILL.md + references

The skill is deliberately tiny: it tells the model to pick a template, not to memorize the API. References are loaded on demand.

**Files:**

- Create: `skill/context-engine/SKILL.md`
- Create: `skill/context-engine/references/schema.md`
- Create: `skill/context-engine/references/events.md`
- Create: `skill/context-engine/references/matching.md`
- Create: `skill/context-engine/references/actions.md`
- Create: `skill/context-engine/references/tool-hooks.md`
- Create: `skill/context-engine/references/examples.md`

**Step 1: Create `SKILL.md`**

```markdown
---
name: context-engine
description: Creates .pi/context/*.md declarative behavior rules for the Pi context-engine extension — conditional context injection, tool guards, confirmations, post-tool guidance. Use when asked to add project conventions (UI, git, testing, security), guardrails, or conditional context to a Pi project.
---

# Context Engine

The `context-engine` Pi extension turns `.pi/context/*.md` files into behaviors:
the YAML frontmatter describes WHEN a rule applies and WHAT it does; the Markdown
body is the context injected into the agent. The frontmatter is never shown to
the model — only the body is.

## Workflow

1. Pick the template in `templates/` closest to the requested behavior.
2. Copy it to `.pi/context/<name>.md` and fill in the frontmatter + body.
3. Tell the user to restart pi (rules load at `session_start`).

## Rules of thumb

- YAML describes behavior; Markdown is the context. Never put logic in the body.
- A file without frontmatter is inert documentation.
- Guard rules (`confirm`, `block`) need no Markdown body.
- Consult `references/` only when a template doesn't fit: `schema.md` (full
  reference), `matching.md` (how `match` works), `actions.md` (what actions do),
  `events.md` (which events exist and what they match against).
```

**Step 2: Create `references/schema.md`**

```markdown
# Frontmatter schema

Every rule file starts with a `---`-delimited YAML block. Unknown keys are
ignored (tolerated), so older examples keep working.

| Key | Required | Type | Meaning |
|-----|----------|------|---------|
| `name` | yes | string | Unique rule id. Used as section header in injected context and in block reasons. |
| `description` | no | string | Shown to the user / used as block reason fallback. |
| `events` | yes | string[] | `before_agent_start`, `tool_call`. (Future: `input`, `tool_result`.) |
| `match` | no | map | When the rule applies. Absent = always. See matching.md. |
| `action` | yes | map | What happens when it applies. See actions.md. |
| `priority` | no | `high` \| `normal` \| `low` | `high`=3, `normal`=2, `low`=1. Rules run priority-desc. Default `normal`. |

Example:

```yaml
---
name: ui-context
description: Conventions UI
events: [before_agent_start]
match:
  input: {contains: [ui, ux]}
action:
  type: inject
  once: true
priority: normal
---
```

The Markdown body after the closing `---` is the injected context. For guard
rules (`confirm`, `block`) the body is unused and may be empty.

```

**Step 3: Create `references/events.md`**

```markdown
# Events

A rule fires on the events listed in `events`. Each event exposes a different
"subject" that `match` runs against.

## before_agent_start

Fires after the user submits a prompt, before the agent loop.

- Subject text: the user's prompt (`event.prompt`).
- Supported actions: `inject`.
- The injected body is appended to the system prompt. `once: true` injects
  only on the first matching prompt of the session.

## tool_call

Fires before a tool executes. Can block, confirm, modify, or queue guidance.

- Subject: tool name (`event.toolName`), the tool input JSON, and `command`
  (the string value of `input.command` for bash-like tools).
- Supported actions: `block`, `confirm`, `modify`, `inject`.
- `inject` here means: queue the body, delivered before the next LLM call via
  the `context` event — guidance the model sees right after the tool result.

## Future (not implemented in v1)

- `input` — raw user input before skill/template expansion (transform/handled).
- `tool_result` — react to tool output (modify/annotate results).

Files must list at least one implemented event; listing a future event is
currently accepted but has no effect.
```

**Step 4: Create `references/matching.md`**

```markdown
# Matching

`match` is optional; absent = the rule always applies. All text comparisons are
case-insensitive substrings unless a `regex` is given.

| Key | Applies to | Shape |
|-----|-----------|-------|
| `input` | prompt text (before_agent_start) or tool input JSON (tool_call) | string \| string[] \| `{contains: [...]}` \| `{regex: [...]}` \| list of these |
| `command` | `input.command` string (bash-like tools) | same shapes as `input` |
| `tool` | tool name (tool_call) | string \| string[] |
| `any` | whole rule | list of sub-specs; if ANY matches, the rule matches immediately |

Semantics:

- Inside one pattern object, `contains` and `regex` are OR'd; each list is
  any-of. `{contains: [ui, ux]}` matches "ui" or "ux".
- `regex` entries are anchored as written: use `^` for command starts
  (`"^git push"`), and mind `--force` variants (`"^git push --force"`).
- Example — bash guard:

```yaml
match:
  tool: bash
  command:
    regex: ["^git push", "^git reset --hard"]
```

- Example — OR across heterogeneous specs:

```yaml
match:
  any:
    - input: {contains: ["test"]}
    - tool: bash
```

```

**Step 5: Create `references/actions.md`**

```markdown
# Actions

| Action | Events | Effect |
|--------|--------|--------|
| `inject` | before_agent_start, tool_call | Body appended to system prompt (agent start) or queued for the next LLM call (tool_call). |
| `confirm` | tool_call | `ctx.ui.confirm(name, message)`. Declined → tool blocked. Without UI, blocks fail-safe. |
| `block` | tool_call | Tool blocked with `message` (or name) as the reason. |
| `modify` | tool_call | Patches `input.command` in place: `command: {append: "...", prepend: "..."}`. |

`inject` options:

- `once: true` — inject only once per session (tracked per rule name).
- Without `once`, `before_agent_start` injects on every matching prompt — use
  `once` for conventions, plain inject for turn-specific reminders.

`confirm` / `block` need no Markdown body.

Security note: `confirm` is fail-safe. If pi has no UI (`ctx.hasUI === false`),
a confirm rule blocks rather than silently allowing.
```

**Step 6: Create `references/tool-hooks.md`**

```markdown
# Tool hooks in depth

`tool_call` rules run in priority order (high → low). The first `block` return
wins and stops the loop; `confirm` approvals, `modify` patches, and `inject`
queues all accumulate before the tool executes.

Execution guarantees (pi SDK):

- `event.input` is mutable; patches affect the real execution. No re-validation
  happens after mutation.
- `{ block: true, reason }` cancels the tool; add `terminate: true` to also end
  the agent turn.
- The `context` event fires before the next LLM call; queued `inject` bodies are
  appended there as a `system` message (drained once — one delivery per tool call).

Typical guard shape:

```yaml
---
name: dangerous-git
events: [tool_call]
match:
  tool: bash
  command: {regex: ["^git reset --hard"]}
action:
  type: confirm
  message: "Destructive git command."
priority: high
---
```

Future: `tool_result` reactions (annotate/summarize tool output).

```

**Step 7: Create `references/examples.md`**

```markdown
# Examples

## 1. Always-on conventions (every matching prompt, once per session)

```markdown
---
name: ui-context
events: [before_agent_start]
match:
  input: {contains: [ui, ux, "interface utilisateur"]}
action: {type: inject, once: true}
---

# UI Conventions

- Reuse existing components.
- French UI strings, English identifiers.
```

## 2. Confirm destructive git

```markdown
---
name: git-safety
events: [tool_call]
match:
  tool: bash
  command: {regex: ["^git push", "^git reset --hard", "^git push --force"]}
action:
  type: confirm
  message: "Commande Git potentiellement destructive."
priority: high
---
```

## 3. Hard-block a tool

```markdown
---
name: no-destructive-rm
events: [tool_call]
match:
  tool: bash
  command: {regex: ["rm -rf"]}
action:
  type: block
  message: "rm -rf is banned in this project."
---
```

## 4. Guidance after a test run (tool_call inject → next LLM call)

```markdown
---
name: test-context
events: [tool_call]
match:
  tool: bash
  command: {contains: ["pytest", "vitest", "go test"]}
action: {type: inject, once: true}
---

# Testing

- Run the focused test, not the whole suite.
```

## 5. OR across heterogeneous specs

```markdown
---
name: test-context
events: [tool_call, before_agent_start]
match:
  any:
    - input: {contains: ["test"]}
    - tool: bash
action: {type: inject}
---
```

For guard rules the body is unused; keep it empty.

```

**Step 8: Commit**

```bash
git add skill/context-engine
git commit -m "docs: context-engine skill (SKILL.md + references)"
```

---

## Task 8: Skill — templates

Six ultra-short templates; the model copies the closest one instead of writing
frontmatter from memory. `result-context.md` (tool_result reactions) is
intentionally absent — that event is not implemented in v1.

**Files:**

- Create: `skill/context-engine/templates/inject.md`
- Create: `skill/context-engine/templates/conditional.md`
- Create: `skill/context-engine/templates/session-context.md`
- Create: `skill/context-engine/templates/tool-confirm.md`
- Create: `skill/context-engine/templates/tool-block.md`
- Create: `skill/context-engine/templates/tool-context.md`

**Step 1: Create the templates**

`templates/inject.md` — unconditional, every matching prompt:

```markdown
---
name: <kebab-name>
description: <what and when>
events: [before_agent_start]
action: {type: inject}
---

<context body>
```

`templates/conditional.md` — gated on prompt keywords:

```markdown
---
name: <kebab-name>
description: <what and when>
events: [before_agent_start]
match:
  input: {contains: [<keyword>, <keyword>]}
action: {type: inject}
---

<context body>
```

`templates/session-context.md` — once per session:

```markdown
---
name: <kebab-name>
description: <what and when>
events: [before_agent_start]
match:
  input: {contains: [<keyword>]}
action: {type: inject, once: true}
---

<context body>
```

`templates/tool-confirm.md` — confirm before a dangerous command:

```markdown
---
name: <kebab-name>
description: <what and when>
events: [tool_call]
match:
  tool: bash
  command: {regex: ["^<command>"]}
action:
  type: confirm
  message: "<user-visible warning>"
priority: high
---
```

`templates/tool-block.md` — hard block:

```markdown
---
name: <kebab-name>
description: <what and when>
events: [tool_call]
match:
  tool: bash
  command: {regex: ["<pattern>"]}
action:
  type: block
  message: "<reason>"
---
```

`templates/tool-context.md` — guidance right after a tool runs:

```markdown
---
name: <kebab-name>
description: <what and when>
events: [tool_call]
match:
  tool: bash
  command: {contains: ["<cmd>"]}
action: {type: inject, once: true}
---

<context body — shown to the model right after the tool result>
```

**Step 2: Commit**

```bash
git add skill/context-engine/templates
git commit -m "docs: context-engine skill templates"
```

---

## Task 9: README + E2E verification + final commit

**Files:**

- Modify: `README.md`

**Step 1: Write the real README**

```markdown
# no-agents dot md

Replace the monolithic `AGENTS.md` with tiny declarative context files
(`.pi/context/*.md`) driven by a Pi extension. Each file is a micro-context:
the YAML frontmatter describes the behavior, the Markdown body is the context
the agent actually sees — injected only when it applies.

```

.pi/
├── context/                 # behavior rules (copy into your project)
│   ├── ui.md                #   conditional context on UI/UX prompts
│   ├── git-safety.md        #   confirm destructive git commands
│   └── test-context.md      #   testing conventions after a test run
└── extensions/
    └── context-engine/      # the extension (copy into your project)
        ├── index.ts         #   event wiring
        ├── engine.ts        #   rule model + loader
        ├── match.ts         #   declarative matcher
        └── frontmatter.ts   #   YAML-subset parser
skill/context-engine/        # the skill (copy to ~/.pi/agent/skills/)

```

## Install

1. Copy the extension into your project:

   ```bash
   cp -r .pi/extensions/context-engine <project>/.pi/extensions/
   ```

1. Copy (or adapt) the example rules:

   ```bash
   cp -r .pi/context <project>/.pi/context
   ```

2. Install the skill globally:

   ```bash
   cp -r skill/context-engine ~/.pi/agent/skills/
   ```

3. Restart pi in the project. You should see:

   ```
   [context-engine] 3 rule(s) loaded from .pi/context/
   ```

## Write a rule

Copy the closest template from `skill/context-engine/templates/` into
`.pi/context/<name>.md`, fill it in, restart pi. Full schema in
`skill/context-engine/references/schema.md`.

## Verify

- "improve the ui" → the UI conventions appear in the system prompt.
- `git push` → pi asks for confirmation.
- `pytest -x` → testing conventions show up right after the result.

## Test

```bash
cd .pi/extensions/context-engine && node --test "*.test.ts"
```

Zero npm dependencies; runs on Node ≥ 22.6 (native TS type-stripping).

## Roadmap

- `input` event (transform/handled) and `tool_result` reactions.
- File watching (reload rules on change instead of restart).
- `position: message` injection (a real injected message, not system prompt).

```

**Step 2: E2E verification checklist**

1. Run the full test suite:
   Run: `cd .pi/extensions/context-engine && node --test "*.test.ts"` → 29 tests pass.
2. Launch pi in this repo (`pi`), confirm the log line:
   `[context-engine] 3 rule(s) loaded from .pi/context/`.
   If pi is not installed/usable in this environment, note it and rely on the
   fake-pi wiring tests (Task 5) as the gate.
3. Prompt pi with "improve the ui" and confirm the UI conventions appear.
4. Ask pi to run `git push` and confirm the confirmation prompt appears.

**Step 3: Final commit**

```bash
git add -A
git commit -m "docs: project README"
```

---

## Definition of done

- [ ] `node --test "*.test.ts"` in `.pi/extensions/context-engine` → 29 pass, 0 fail.
- [ ] Extension loads in a real pi session, logs rule count at `session_start`.
- [ ] Conditional inject, confirm, block, modify, and post-tool guidance all work (manual checklist).
- [ ] Skill installs and its SKILL.md fits on one screen; templates are one-screen each.
- [ ] No npm dependencies; no AGENTS.md anywhere in the repo (that is the point).
- [ ] README covers install, write-a-rule, verify, test, roadmap.
