/** Orchestrator: normalize -> decode -> scan -> aggregate. No pi imports. */

import {
  aggregate,
  isTerminal,
  mkFinding,
  type Finding,
  type RiskLevel,
  type ScanResult,
} from "./types.ts";
import { findDecodedBlobs } from "./encoding.ts";
import { scanUnicode } from "./unicode.ts";
import {
  stripCodeBlocks,
  stripHtmlComments,
  scanMarkdown,
  findCodeBlocks,
} from "./markdown.ts";
import { scanRules, scanExternalRefs } from "./rules.ts";
import { scanCommand } from "./commands.ts";

export type Provenance = "user" | "downloaded" | "untrusted-project";

const DOWNLOAD_AGE_MS = 3600000; // 1 hour

/**
 * Classify where a rule file came from, from best-effort signals.
 * 'downloaded' wins (a recent untracked file is, by definition, not authored
 * in this project); an untrusted project marks everything it contains.
 */
export function provenance(
  _file: string,
  signals: {
    isProjectTrusted: boolean;
    now?: Date;
    mtimeMs?: number;
    gitTracked?: boolean;
  },
): Provenance {
  const now = signals.now ?? new Date();
  if (
    signals.gitTracked === false &&
    signals.mtimeMs !== undefined &&
    now.getTime() - signals.mtimeMs < DOWNLOAD_AGE_MS
  ) {
    return "downloaded";
  }
  if (!signals.isProjectTrusted) return "untrusted-project";
  return "user";
}

const NEXT_LEVEL: RiskLevel[] = ["none", "low", "medium", "high", "critical"];

/**
 * Provenance nudge (Task 13): raise the level one step for downloaded /
 * untrusted-project files with findings. Never raises 'none', and high only
 * rises to critical when a terminal finding is present (a CRITICAL decision
 * always needs a terminal finding or a >= critical score).
 */
export function nudgeLevel(
  level: RiskLevel,
  prov: Provenance,
  findings: Finding[],
): RiskLevel {
  if (level === "none" || level === "critical") return level;
  if (findings.length === 0) return level;
  if (prov !== "downloaded" && prov !== "untrusted-project") return level;
  if (level === "high") return isTerminal(findings) ? "critical" : "high";
  return NEXT_LEVEL[NEXT_LEVEL.indexOf(level) + 1];
}

/** Scan a context rule file (raw markdown). `file` is reserved for provenance. */
export function scanContext(raw: string, _file: string): ScanResult {
  const text = raw.replace(/\r\n/g, "\n");
  const findings: Finding[] = [];
  const { decoded, findings: encFindings } = findDecodedBlobs(text);
  findings.push(...encFindings);
  findings.push(...scanUnicode(text));
  for (const blob of decoded) {
    findings.push(...scanUnicode(blob.text));
  }
  // Hidden-content scan runs on the code-block-stripped text; the visible
  // injection scan additionally strips html comments (anti-false-positive).
  const noCode = stripCodeBlocks(text);
  const visible = stripHtmlComments(noCode);
  findings.push(...scanMarkdown(noCode));
  findings.push(...scanRules(visible));
  findings.push(...scanExternalRefs(visible));
  // H-1: fenced content is injected verbatim into the system prompt — scan it.
  // Cap: code blocks are often legit examples => severity capped at high,
  // terminal cleared. Result: instruction-like fenced content is never silent
  // (>= medium => confirm) but never auto-critical.
  for (const cb of findCodeBlocks(text)) {
    const label = cb.closed ? "code block" : "unclosed code block";
    for (const f of [
      ...scanRules(cb.text, { lineOffset: cb.line, label }),
      ...scanExternalRefs(cb.text, { lineOffset: cb.line, label }),
    ]) {
      if (f.severity === "critical" || f.terminal) {
        f.severity = "high";
        f.score = 10;
        f.terminal = false;
      }
      findings.push(f);
    }
  }
  for (const blob of decoded) {
    const label = `decoded ${blob.from}`;
    findings.push(...scanRules(blob.text, { label }));
    findings.push(...scanExternalRefs(blob.text, { label }));
  }
  return {
    level: aggregate(findings),
    findings,
    decoded: decoded.length > 0 ? decoded : undefined,
  };
}

/** Scan parsed frontmatter as behavior (tool-hijack signals). */
export function scanFrontmatter(meta: Record<string, unknown>): ScanResult {
  const findings: Finding[] = [];
  const action = meta.action;
  if (action && typeof action === "object") {
    const a = action as Record<string, unknown>;
    const type = typeof a.type === "string" ? a.type : "";
    if (
      type === "modify" ||
      type === "tools" ||
      type === "transform" ||
      type === "handled" ||
      type === "confirm"
    ) {
      findings.push(
        mkFinding(
          "th-action-present",
          "tool-hijack",
          "info",
          "low",
          `frontmatter action.type "${type}"`,
        ),
      );
    }
    if (type === "tools") {
      findings.push(
        mkFinding(
          "th-tools",
          "tool-hijack",
          "high",
          "high",
          "frontmatter action enables tools",
        ),
      );
    }
    if (type === "modify" && a.command && typeof a.command === "object") {
      const cmd = a.command as Record<string, unknown>;
      for (const key of ["prepend", "append"]) {
        const val = typeof cmd[key] === "string" ? cmd[key] : "";
        if (val === "") continue;
        const network = /https?:\/\/|\b(curl|wget|nc|ncat|fetch)\b/i.test(val);
        const exec =
          /\|\s*(?:ba|z|da)?sh\b|\b(?:ba|z|da)?sh\s+-c\b|\b(node|python|python3|perl|ruby|eval|execute)\b|\bbase64\s+-d\b/i.test(
            val,
          );
        if (network && exec) {
          findings.push(
            mkFinding(
              "th-modify-netexec",
              "tool-hijack",
              "high",
              "high",
              `frontmatter action.modify.command.${key} performs network + execution`,
              { terminal: true },
            ),
          );
        } else if (network || exec) {
          findings.push(
            mkFinding(
              "th-modify-net",
              "tool-hijack",
              "medium",
              "medium",
              `frontmatter action.modify.command.${key} contains ${
                network ? "network" : "execution"
              }`,
            ),
          );
        }
      }
      // H-7: the prepend/append IS code that runs on every matching user_bash —
      // scan it with the full command scanner (destructive, exfil, dl-exec...).
      for (const key of ["prepend", "append"]) {
        const val = typeof cmd[key] === "string" ? cmd[key] : "";
        if (val === "") continue;
        const sr = scanCommand(val);
        for (const f of sr.findings) {
          findings.push({
            ...f,
            evidence: `frontmatter action.modify.command.${key}: ${f.evidence}`,
          });
        }
      }
    }
    if (type === "confirm") {
      const msg = typeof a.message === "string" ? a.message.trim() : "";
      const generic =
        msg === "" ||
        msg.length < 8 ||
        /^(are you sure|proceed|confirm|continue|ok|yes|allow|go ahead)[?.!]*$/i.test(
          msg,
        );
      if (generic) {
        findings.push(
          mkFinding(
            "th-confirm-generic",
            "tool-hijack",
            "medium",
            "medium",
            "frontmatter confirm uses a generic message",
          ),
        );
      }
    }
  }
  return { level: aggregate(findings), findings };
}
