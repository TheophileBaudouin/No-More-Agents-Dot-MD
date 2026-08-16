/** Pure rule matcher. No pi imports — unit-testable with node --test. */

// F6: user match.regex is validated before use — ReDoS caps + syntax check.
// The number of patterns is bounded by the rule files, so both caches below
// are bounded too.
const MAX_REGEX_LEN = 200;
const NESTED_QUANT_RE =
  /(?:\([^)]*[+*][^)]*\)\s*[+*{]|\(\s*[^)]*\{\d*,?\d*\}[^)]*\)\s*[+*{])/;

export function validateRegex(r: string): string | null {
  if (r.length > MAX_REGEX_LEN)
    return `regex too long (${r.length} > ${MAX_REGEX_LEN})`;
  if (NESTED_QUANT_RE.test(r)) return "nested quantifiers (ReDoS risk)";
  try {
    new RegExp(r);
  } catch (e) {
    return `invalid regex: ${(e as Error).message}`;
  }
  return null;
}

const regexCache = new Map<string, RegExp>();
const reportedBadRegex = new Set<string>();

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

/** Any-of semantics: one `contains` substring OR one `regex` must hit.
 * Invalid regexes (F6) are skipped — one log per pattern, never a throw. */
function matchPatterns(p: unknown, text: string): boolean {
 const list = patternList(p);
 if (list.length === 0) return false;
 return list.some((pat) => {
  if (pat.contains.some((s) => text.toLowerCase().includes(s.toLowerCase()))) {
   return true;
  }
  for (const r of pat.regex) {
   const err = validateRegex(r);
   if (err !== null) {
    if (!reportedBadRegex.has(r)) {
     reportedBadRegex.add(r);
     console.warn(`match.regex skipped (${err}): ${r.slice(0, 60)}`);
    }
    continue; // invalid pattern never matches
   }
   let re = regexCache.get(r);
   if (re === undefined) {
    re = new RegExp(r);
    regexCache.set(r, re);
   }
   if (re.test(text)) return true;
  }
  return false;
 });
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
  // (any other key present means the rule can still match)
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
