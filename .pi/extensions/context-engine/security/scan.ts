/** Orchestrator: normalize -> decode -> scan -> aggregate. No pi imports. */

import { aggregate, mkFinding, type Finding, type ScanResult } from "./types.ts";
import { findDecodedBlobs } from "./encoding.ts";
import { scanUnicode } from "./unicode.ts";
import { stripCodeBlocks, stripHtmlComments, scanMarkdown } from "./markdown.ts";
import { scanRules, scanExternalRefs } from "./rules.ts";

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
        mkFinding("th-tools", "tool-hijack", "high", "high", "frontmatter action enables tools"),
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
    }
    if (type === "confirm") {
      const msg = typeof a.message === "string" ? a.message.trim() : "";
      const generic =
        msg === "" ||
        msg.length < 8 ||
        /^(are you sure|proceed|confirm|continue|ok|yes|allow|go ahead)[?.!]*$/i.test(msg);
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
