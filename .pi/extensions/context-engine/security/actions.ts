/** Action barrier B (Task 11): deterministic scan of tool inputs. No pi imports. */

import { aggregate, mkFinding, type Finding, type ScanResult } from "./types.ts";
import { scanCommand } from "./commands.ts";
import { extractTargets } from "./npm.ts";

const BASH_TOOLS = new Set(["bash", "sh", "zsh", "shell", "pwsh", "powershell"]);
const FILE_TOOLS = new Set(["read", "write", "edit"]);

/** Secret-material paths (private keys, env files, credentials). */
const SECRET_PATH_RE =
  /(?:^|[\\/])\.ssh(?:[\\/]|$)|(?:^|[\\/])\.env(?!\.(?:example|sample|template|dist))(?![A-Za-z0-9_.])|\.pem(?:$|[^A-Za-z0-9])|\bid_rsa\b|\bid_ed25519\b|(?:\.aws|aws)[\\/]credentials|(?:^|[\\/])\.npmrc(?:$|[^A-Za-z0-9_.])/i;

/** System-sensitive write targets. */
const SENSITIVE_WRITE_RE =
  /(?:^|[\\/])(?:etc|System)(?:[\\/]|$)|(?:^|[\\/])usr[\\/]s?bin(?:[\\/]|$)|(?:^|[\\/])Library[\\/]Launch(?:Agents|Daemons)(?:[\\/]|$)|(?:^|[\\/])var[\\/]root(?:[\\/]|$)|(?:^|[\\/])crontab(?:$|[^A-Za-z0-9])/i;

function excerpt(s: string): string {
  return s.trim().replace(/\s+/g, " ").slice(0, 80);
}

/**
 * Scan a tool action before it runs. Scope: shell commands (bash-like tools),
 * and file tools touching secret or system-sensitive paths. Everything else
 * is "none". Synchronous and pure — network enrichment happens separately.
 */
export function scanAction(toolName: string, input: unknown): ScanResult {
  const tool = String(toolName ?? "").toLowerCase();
  const obj = (input ?? {}) as Record<string, unknown>;
  if (BASH_TOOLS.has(tool)) {
    const command = typeof obj.command === "string" ? obj.command : "";
    if (command === "") return { level: "none", findings: [] };
    return scanCommand(command);
  }
  if (FILE_TOOLS.has(tool)) {
    const p = typeof obj.path === "string" ? obj.path : "";
    if (p === "") return { level: "none", findings: [] };
    const findings: Finding[] = [];
    if (SECRET_PATH_RE.test(p)) {
      findings.push(
        mkFinding("act-secret-path", "secrets", "high", "high", `${tool} ${excerpt(p)}`),
      );
    }
    if ((tool === "write" || tool === "edit") && SENSITIVE_WRITE_RE.test(p)) {
      findings.push(
        mkFinding("act-system-write", "command", "high", "high", `${tool} ${excerpt(p)}`),
      );
    }
    // F3: a written script's content IS a future command — scan it. Shebang
    // files and script extensions qualify; evidence is prefixed with the tool.
    if (tool === "write" || tool === "edit") {
      const content = typeof obj.content === "string" ? obj.content : "";
      const scriptPath = /\.(?:sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl)$/i.test(p);
      if (content !== "" && (scriptPath || content.startsWith("#!"))) {
        for (const f of scanCommand(content).findings) {
          findings.push({ ...f, evidence: `${tool} content: ${f.evidence}` });
        }
      }
    }
    return { level: aggregate(findings), findings };
  }
  return { level: "none", findings: [] };
}

/** True for install commands with named targets (npm/yarn/bun/pnpm/npx/pip/cargo). */
export function isInstallCommand(command: string): boolean {
  return extractTargets(command).length > 0;
}

/** Network enrichment only ever runs for install commands. */
export function needsNetworkCheck(_sr: ScanResult, command: string): boolean {
  return isInstallCommand(command);
}
