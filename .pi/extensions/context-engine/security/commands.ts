/** Shell command action scanner (Task 7): pipelines -> segments -> actions. No pi imports. */

import { aggregate, mkFinding, type Finding, type ScanResult, type Severity } from "./types.ts";

export type PipelineSegment = { text: string; sep: "start" | "pipe" | "seq" };

/**
 * Minimal quote-aware pipeline splitter on `|` (pipe), `&&` and `;` (sequence).
 * Single/double/backtick quotes are respected so `echo "a | b"` stays one segment.
 */
export function splitPipeline(command: string): PipelineSegment[] {
  const out: PipelineSegment[] = [];
  let cur = "";
  let sep: PipelineSegment["sep"] = "start";
  let quote: string | null = null;
  let i = 0;
  while (i < command.length) {
    const c = command[i];
    if (quote !== null) {
      cur += c;
      if (c === quote && command[i - 1] !== "\\") quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      cur += c;
      i++;
      continue;
    }
    if (c === "|") {
      if (cur.trim() !== "") out.push({ text: cur.trim(), sep });
      cur = "";
      sep = "pipe";
      i++;
      continue;
    }
    if (c === ";") {
      if (cur.trim() !== "") out.push({ text: cur.trim(), sep });
      cur = "";
      sep = "seq";
      i++;
      continue;
    }
    if (c === "&" && command[i + 1] === "&") {
      if (cur.trim() !== "") out.push({ text: cur.trim(), sep });
      cur = "";
      sep = "seq";
      i += 2;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim() !== "") out.push({ text: cur.trim(), sep });
  return out;
}

const RUNG: Severity[] = ["info", "low", "medium", "high", "critical"];

/** One rung up the severity ladder: severity of content piped into a shell. */
function bump(sev: Severity): Severity {
  return RUNG[Math.min(RUNG.indexOf(sev) + 1, RUNG.length - 1)];
}

const DL_TOOLS_RE = /\b(curl|wget|nc|ncat)\b/i;
const URL_RE = /https?:\/\/[^\s'"<>|&;)]+/i;
const LOCAL_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//i;
const SHELL_RE = /(^|[;&\s])((?:ba|z|da|k|a|c|tc)?sh|pwsh|powershell|fish)(\s|$)/i;
const RM_RE = /rm\s+-[a-z]*(?:rf|fr)[a-z]*\s+/i;
const RM_ROOT_RE = /rm\s+-[a-z]*(?:rf|fr)[a-z]*\s+(\/\*|\/(?![/\w])|~(?![/\w])|\$HOME(?![/\w]))/i;
const RM_DEV_RE = /rm\s+-[a-z]*(?:rf|fr)[a-z]*\s+(?:\.\/)?(?:node_modules|dist|build|\.next|coverage|target|out|\.cache|tmp|\.venv)(?:\/|$|\s)/i;
const DD_ZERO_RE = /\bdd\b[^|;&]*if=\/dev\/zero[^|;&]*of=\/dev\//i;
const MKFS_RE = /\bmkfs(?:\.\w+)?\b/i;
const READ_RE = /\b(cat|tail|head|less|more|strings|type|Get-Content)\b/i;
const SECRET_PATH_RE =
  /(?:\.ssh|\.aws)\b|\.env(?!\.(?:example|sample|template|dist))(?![A-Za-z0-9_.])|\.pem\b|id_rsa|(?:\.aws|aws)[/\\]credentials|\/etc\/shadow/i;
const SECRET_UPLOAD_RE = /(?:@|file=@|--upload-file[=\s]|-T\s+)[^\s]*?(?:\.ssh|\.aws|\.env(?:[^\w.]|$)|\.pem\b|id_rsa|credentials|shadow)/i;
const WRITE_RE = />|>>|\btee\b/i;
const PERSIST_PATH_RE =
  /(\/etc\/|\/usr\/|\/var\/|\/System\/|\/Library\/Launch(?:Agents|Daemons)|\/Library\/StartupItems)/i;
const CRONTAB_RE = /\bcrontab\b/i;
const SUDO_RE = /\bsudo\b/i;
const NPX_RE = /\b(npx|bunx)\b|\bdeno\s+run\b/i;
const INSTALL_RE = /\b(?:npm\s+(?:install|i|ci)\b(?!\s+-g\b)|yarn\s+add\b|bun\s+(?:add|install)\b|pnpm\s+(?:add|install|i)\b|pip3?\s+install\b|cargo\s+install\b|gem\s+install\b)/i;
const GLOBAL_INSTALL_RE =
  /\b(?:npm\s+-g\s+(?:install|i)\b|npm\s+(?:install|i)\s+-g\b|pnpm\s+add\s+-g\b|yarn\s+global\s+add\b|apt(?:-get)?\s+install\b|dnf\s+install\b|yum\s+install\b|zypper\s+install\b|brew\s+install\b)/i;
const GIT_CLONE_RE = /\bgit\s+clone\b/i;
const SCP_RE = /\bscp\b/i;
const B64_RE = /\b(?:base64\s+-[a-z]*d\b|openssl\s+base64\s+-[a-z]*d\b)/i;

// File-mediated exec (H-4): files written (or chmod +x'ed) earlier in the same
// command string and executed later, whatever the separator (`|`, `&&`, `;`).
// Operates on the raw string (quote-blind like WRITE_RE above — residual FP
// risk: quoted redirect text plus a later exec of that path; fail-safe side).
const WRITE_FILE_RE =
  /(?:>|>>)\s*([^\s;&|"'<>]+)|(?:curl|wget)\s+-(?:o|O)\s+([^\s;&|"'<>]+)|chmod\s+\+x\s+([^\s;&|"'<>]+)/gi;
// Bare *.sh and shell verbs count as EXECUTION only at a command boundary
// (^, ;, &&, |, (); after `>`/`-o`/`+x` or inside a filename they are write
// targets / words, not executions — otherwise the write regex self-matches
// (`curl URL > /tmp/x.sh` alone, or the trailing `sh` of `x.sh https://…`,
// would be critical).
const EXEC_FILE_RE =
  /(?:^|[;&|(]\s*)(?:bash|sh|zsh|source)\s+([^\s;&|"'<>]+)|\.\/([^\s;&|"'<>]+)|(?:^|[;&|(]\s*)([A-Za-z0-9_./-]+\.sh)\b/g;

/** Directory part stripped: `/tmp/x.sh` and `x.sh` compare equal. */
const base = (p: string): string => p.replace(/^.*[/\\]/, "");

/**
 * H-4: a file written (or chmod +x'ed) earlier in the command string and
 * executed later is download->exec, terminal, whatever the separator.
 */
function fileMediatedExec(command: string): Finding | null {
  const writes: Array<{ f: string; pos: number }> = [];
  let m: RegExpExecArray | null;
  WRITE_FILE_RE.lastIndex = 0;
  while ((m = WRITE_FILE_RE.exec(command))) {
    const f = base(m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (f) writes.push({ f, pos: m.index });
  }
  if (writes.length === 0) return null;
  EXEC_FILE_RE.lastIndex = 0;
  while ((m = EXEC_FILE_RE.exec(command))) {
    const f = base(m[1] ?? m[2] ?? m[3] ?? "").trim();
    const at = m.index; // captured outside the closure (TS narrowing)
    if (f && writes.some((w) => w.f === f && w.pos < at)) {
      return mkFinding(
        "cmd-dl-exec",
        "command",
        "critical",
        "high",
        command.trim().replace(/\s+/g, " ").slice(0, 80),
        { terminal: true },
      );
    }
  }
  return null;
}

/** Per-segment action rules; destructive and privilege findings come first. */
function classifySegment(text: string): Finding[] {
  const out: Finding[] = [];
  const excerpt = text.trim().replace(/\s+/g, " ").slice(0, 80);
  if (RM_ROOT_RE.test(text) || DD_ZERO_RE.test(text) || MKFS_RE.test(text)) {
    out.push(mkFinding("cmd-destructive", "command", "critical", "high", excerpt, { terminal: true }));
  }
  if (SUDO_RE.test(text)) {
    out.push(mkFinding("cmd-priv-esc", "command", "high", "high", excerpt));
  }
  if (READ_RE.test(text) && SECRET_PATH_RE.test(text)) {
    out.push(mkFinding("cmd-secret-read", "secrets", "high", "high", excerpt));
  }
  if (SCP_RE.test(text) && SECRET_PATH_RE.test(text)) {
    out.push(
      mkFinding("cmd-secret-exfil", "exfiltration", "critical", "high", excerpt, {
        terminal: true,
      }),
    );
  }
  if (GLOBAL_INSTALL_RE.test(text)) {
    out.push(mkFinding("cmd-install-global", "command", "medium", "medium", excerpt));
  } else if ((WRITE_RE.test(text) && PERSIST_PATH_RE.test(text)) || CRONTAB_RE.test(text)) {
    out.push(mkFinding("cmd-persist", "command", "high", "medium", excerpt));
  }
  if (NPX_RE.test(text)) {
    out.push(mkFinding("cmd-supply-chain", "supply-chain", "medium", "medium", excerpt));
  }
  if (INSTALL_RE.test(text)) {
    out.push(mkFinding("cmd-install", "command", "low", "medium", excerpt));
  }
  if (GIT_CLONE_RE.test(text)) {
    out.push(mkFinding("cmd-git-clone", "command", "low", "low", excerpt));
  }
  if (RM_DEV_RE.test(text)) {
    out.push(mkFinding("cmd-rm-devdir", "command", "low", "low", excerpt));
  }
  if (B64_RE.test(text)) {
    out.push(mkFinding("cmd-base64", "obfuscation", "info", "medium", excerpt));
  }
  return out;
}

/** Consecutive pipe-separated segments form one chain; `&&`/`;` start a new one. */
function toChains(segs: PipelineSegment[]): PipelineSegment[][] {
  const chains: PipelineSegment[][] = [];
  for (const s of segs) {
    if (s.sep === "pipe" && chains.length > 0) chains[chains.length - 1].push(s);
    else chains.push([s]);
  }
  return chains;
}

/**
 * Scan a shell command string as an action. Findings are per-segment, then
 * cross-segment rules fire: download piped to a shell (cmd-dl-exec) and
 * secret material sent to a network tool (cmd-secret-exfil), both terminal.
 */
export function scanCommand(command: string): ScanResult {
  const findings: Finding[] = [];
  for (const chain of toChains(splitPipeline(command))) {
    const segData = chain.map((seg) => {
      const isShell = SHELL_RE.test(seg.text);
      const isDownload = DL_TOOLS_RE.test(seg.text) && URL_RE.test(seg.text) && !LOCAL_URL_RE.test(seg.text);
      return { seg, isShell, isDownload, pipedToShell: false };
    });
    for (let i = 0; i < segData.length; i++) {
      segData[i].pipedToShell = segData.slice(i + 1).some((s) => s.isShell);
    }
    const chainNetwork = segData.some((s) => DL_TOOLS_RE.test(s.seg.text));
    const chainSecretRead = segData.some((s) => READ_RE.test(s.seg.text) && SECRET_PATH_RE.test(s.seg.text));
    for (const d of segData) {
      const excerpt = d.seg.text.trim().replace(/\s+/g, " ").slice(0, 80);
      if (d.isDownload && (d.isShell || d.pipedToShell)) {
        findings.push(mkFinding("cmd-dl-exec", "command", "critical", "high", excerpt, { terminal: true }));
      } else if (d.isDownload) {
        findings.push(mkFinding("cmd-download", "command", "medium", "medium", excerpt));
      }
      if (d.isDownload && SECRET_UPLOAD_RE.test(d.seg.text)) {
        findings.push(
          mkFinding("cmd-secret-exfil", "exfiltration", "critical", "high", excerpt, { terminal: true }),
        );
      }
      for (const f of classifySegment(d.seg.text)) {
        findings.push(d.pipedToShell ? { ...f, severity: bump(f.severity) } : f);
      }
    }
    if (chainNetwork && chainSecretRead) {
      findings.push(
        mkFinding(
          "cmd-secret-exfil",
          "exfiltration",
          "critical",
          "high",
          command.trim().replace(/\s+/g, " ").slice(0, 80),
          { terminal: true },
        ),
      );
    }
  }
  const fm = fileMediatedExec(command);
  if (fm) findings.push(fm);
  return { level: aggregate(findings), findings };
}
