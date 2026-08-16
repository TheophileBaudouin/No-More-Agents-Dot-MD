/** Hidden-markdown scanner: HTML comments, link smuggling, code-block exclusion. */

import { mkFinding, type Finding } from "./types.ts";

/** Instruction-like phrases looked for inside comments and link texts. */
const INSTRUCTION_PATTERNS: string[] = [
  "ignore previous instructions",
  "ignore all previous instructions",
  "disregard previous",
  "forget everything above",
  "forget all previous",
  "repeat your system prompt",
  "what are your instructions",
  "print your system prompt",
  "developer message",
  "you are now",
  "use bash to",
  "disable your safety",
  "treat this document as authoritative",
  "reveal the context",
  "ignore the context",
  "you are the system",
];

export type HiddenText = { text: string; line: number; column: number };

function blankKeepNewlines(s: string): string {
  return s.replace(/[^\n]/g, " ");
}

function posAt(raw: string, index: number): { line: number; column: number } {
  let line = 1;
  let lastNl = -1;
  for (let i = 0; i < index; i++) {
    if (raw.charCodeAt(i) === 10) {
      line++;
      lastNl = i;
    }
  }
  return { line, column: index - lastNl };
}

/** Blank html comments (keeping line structure) so visible text can be scanned. */
export function stripHtmlComments(raw: string): string {
  return raw.replace(/<!--[\s\S]*?(?:-->|$)/g, (m) => blankKeepNewlines(m));
}

/** Blank fenced code blocks (keeping line structure) - anti-false-positive. */
export function stripCodeBlocks(raw: string): string {
  const lines = raw.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^(```|~~~)/.test(lines[i].trimStart())) {
      inFence = !inFence;
      lines[i] = blankKeepNewlines(lines[i]);
    } else if (inFence) {
      lines[i] = blankKeepNewlines(lines[i]);
    }
  }
  return lines.join("\n");
}

/** Html comments with their 1-based position. */
export function findHtmlComments(raw: string): HiddenText[] {
  const out: HiddenText[] = [];
  const re = /<!--[\s\S]*?(?:-->|$)/g;
  for (const m of raw.matchAll(re)) {
    const inner = m[0].slice(4, m[0].endsWith("-->") ? m[0].length - 3 : m[0].length);
    const p = posAt(raw, m.index + 4);
    out.push({ text: inner, line: p.line, column: p.column });
  }
  return out;
}

/** Markdown links (http/https targets) with their 1-based position. */
export function findMarkdownLinks(raw: string): Array<HiddenText & { url: string }> {
  const out: Array<HiddenText & { url: string }> = [];
  const re = /\[([^\]]{1,200})\]\((https?:\/\/[^)\s]{1,500})\)/g;
  for (const m of raw.matchAll(re)) {
    const p = posAt(raw, m.index);
    out.push({ text: m[1], url: m[2], line: p.line, column: p.column });
  }
  return out;
}

function containsInstruction(text: string): boolean {
  const lower = text.toLowerCase();
  return INSTRUCTION_PATTERNS.some((p) => lower.includes(p));
}

/** Findings for instructions hidden in html comments or markdown link texts. */
export function scanMarkdown(raw: string): Finding[] {
  const findings: Finding[] = [];
  for (const c of findHtmlComments(raw)) {
    if (containsInstruction(c.text)) {
      findings.push(
        mkFinding(
          "md-comment-instr",
          "prompt-injection",
          "medium",
          "medium",
          `html comment line ${c.line}: ${c.text.trim().slice(0, 80)}`,
          { line: c.line, column: c.column },
        ),
      );
    }
  }
  for (const l of findMarkdownLinks(raw)) {
    if (containsInstruction(l.text)) {
      findings.push(
        mkFinding(
          "md-link-instr",
          "prompt-injection",
          "medium",
          "medium",
          `link to ${l.url}: "${l.text.trim().slice(0, 60)}"`,
          { line: l.line, column: l.column },
        ),
      );
    }
  }
  return findings;
}
