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
