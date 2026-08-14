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
