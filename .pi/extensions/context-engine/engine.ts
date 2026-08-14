/** Rule model, loader, and pure selection helpers. No pi imports. */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseYamlSubset } from "./frontmatter.ts";
import { matchRule, type Subject } from "./match.ts";

export type RuleAction = {
 type: "inject" | "confirm" | "block" | "modify" | "tools" | "notify" | "transform" | "handled" | "annotate";
 once?: boolean;
 message?: string;
 level?: "info" | "warning" | "error";
 command?: { append?: string; prepend?: string };
 enable?: string[];
 disable?: string[];
 text?: string;
 append?: string;
 details?: unknown;
};

export const VALID_EVENTS: readonly string[] = [
 "before_agent_start",
 "tool_call",
 "tool_result",
 "input",
 "user_bash",
 "session_before_switch",
 "session_before_fork",
];

/** Event → allowed action types. */
export const EVENT_ACTIONS: Record<string, readonly string[]> = {
 before_agent_start: ["inject", "tools", "notify"],
 tool_call: ["block", "confirm", "modify", "inject", "tools", "notify"],
 tool_result: ["annotate", "inject", "notify"],
 input: ["transform", "handled", "tools", "notify"],
 user_bash: ["block", "confirm", "modify", "notify"],
 session_before_switch: ["confirm", "block", "notify"],
 session_before_fork: ["confirm", "block", "notify"],
};

const VALID_ACTIONS: readonly string[] = [
 "inject",
 "confirm",
 "block",
 "modify",
 "tools",
 "notify",
 "transform",
 "handled",
 "annotate",
];

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
 if (!VALID_ACTIONS.includes(action.type)) {
  throw new Error(`unknown action.type "${action.type}" (valid: ${VALID_ACTIONS.join(", ")})`);
 }
 const eventNames = events.map(String);
 for (const e of eventNames) {
  if (!VALID_EVENTS.includes(e)) {
   throw new Error(`unknown event "${e}" (valid: ${VALID_EVENTS.join(", ")})`);
  }
 }
 for (const e of eventNames) {
  if (!EVENT_ACTIONS[e].includes(action.type)) {
   throw new Error(
    `action "${action.type}" is not allowed for event "${e}" (allowed: ${EVENT_ACTIONS[e].join(", ")})`,
   );
  }
 }
 let priority = 2; // normal
 if (meta.priority === "high") priority = 3;
 else if (meta.priority === "low") priority = 1;
 return {
  name,
  description: typeof meta.description === "string" ? meta.description : "",
  events: eventNames,
  match: (meta.match as Record<string, unknown> | undefined) ?? undefined,
  action,
  priority,
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
   console.error(`[No More Agents Dot MD] ${f}: ${(e as Error).message}`);
  }
 }
 return sortRules(rules);
}

/** Pure selection for any event (all action types; priority order preserved). */
export function selectForEvent(rules: Rule[], subject: Subject, event: string): Rule[] {
 return rules.filter((r) => r.events.includes(event) && matchRule(r.match, subject));
}

/** Pure selection for before_agent_start injection. */
export function selectInject(rules: Rule[], subject: Subject, injectedOnce: Set<string>): Rule[] {
 return selectForEvent(rules, subject, "before_agent_start").filter(
  (r) => r.action.type === "inject" && (!r.action.once || !injectedOnce.has(r.name)),
 );
}

/** Pure selection for tool_call (all action types; priority order preserved). */
export function selectToolRules(rules: Rule[], subject: Subject): Rule[] {
 return selectForEvent(rules, subject, "tool_call");
}
