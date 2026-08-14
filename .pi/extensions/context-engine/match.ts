/** Pure rule matcher. No pi imports — unit-testable with node --test. */

export type Subject = {
 /** Text matched against `input` patterns (prompt text or tool input JSON). */
 text: string;
 /** Tool name, set for tool_call subjects. */
 tool?: string;
 /** String value of `input.command`, set for bash-like tool calls. */
 command?: string;
 /** Tool output text, set for tool_result subjects. */
 result?: string;
 /** Active model as "provider/id", set when ctx.model is available. */
 model?: string;
 /** Working directory, set for session-bound events. */
 cwd?: string;
 /** Number of session entries, set for session-bound events. */
 sessionSize?: number;
 /** Context usage percent 0-100, set when ctx.getContextUsage() is available. */
 contextFill?: number;
 /** Input source, set for input subjects: interactive|rpc|extension. */
 source?: string;
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

/**
 * Numeric threshold matching: a bare number means "value >= n";
 * {min, max} means inclusive bounds. Missing value never matches.
 */
function matchCount(spec: unknown, value: number | undefined): boolean {
 if (value === undefined) return false;
 if (typeof spec === "number") return value >= spec;
 if (spec && typeof spec === "object") {
  const { min, max } = spec as Record<string, unknown>;
  if (typeof min === "number" && value < min) return false;
  if (typeof max === "number" && value > max) return false;
  return true;
 }
 return false;
}

export function matchRule(m: MatchSpec | undefined, s: Subject): boolean {
 if (!m) return true;

 // `any` is an OR shortcut: any matching sub-spec wins immediately.
 if (Array.isArray(m.any)) {
  if (m.any.some((sub) => sub && typeof sub === "object" && matchRule(sub as MatchSpec, s))) {
   return true;
  }
  // none of the sub-specs matched; only remaining keys can still match
  // (covers v1 + v2 keys: any other key present means the rule can still match)
  if (Object.keys(m).filter((k) => k !== "any").length === 0) {
   return false;
  }
 }

 if (m.tool !== undefined) {
  const tools = Array.isArray(m.tool) ? m.tool.map(String) : [String(m.tool)];
  if (!s.tool || !tools.includes(s.tool)) return false;
 }
 if (m.input !== undefined && !matchPatterns(m.input, s.text)) return false;
 if (m.command !== undefined && !matchPatterns(m.command, s.command ?? "")) return false;
 if (m.model !== undefined) {
  const targets = Array.isArray(m.model) ? m.model.map(String) : [String(m.model)];
  if (!s.model || !targets.some((t) => s.model!.toLowerCase().includes(t.toLowerCase()))) {
   return false;
  }
 }
 if (m.cwd !== undefined) {
  if (s.cwd === undefined || !matchPatterns(m.cwd, s.cwd)) return false;
 }
 if (m.sessionSize !== undefined && !matchCount(m.sessionSize, s.sessionSize)) return false;
 if (m.contextFill !== undefined && !matchCount(m.contextFill, s.contextFill)) return false;
 if (m.result !== undefined && !matchPatterns(m.result, s.result ?? "")) return false;
 if (m.source !== undefined) {
  const targets = Array.isArray(m.source) ? m.source.map(String) : [String(m.source)];
  if (!s.source || !targets.includes(s.source)) return false;
 }
 return true;
}
