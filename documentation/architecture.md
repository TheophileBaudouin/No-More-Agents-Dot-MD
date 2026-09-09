# Architecture — how the engine works

This page is for the curious and for contributors. It explains the design
decisions, the data flow, and how to extend the engine. If you just want to
*write rules*, you don't need this — see [Writing rules](writing-rules.md).

## Design goals

1. **Zero npm dependencies.** The YAML frontmatter is parsed by a hand-written
   YAML-subset parser (~100 lines) — no YAML library, no framework. The whole
   engine is 17 source files (4 core + 13 in `security/`) and runs on
   Node ≥ 22.6 (native TS type-stripping, tests via
   `node --test "*.test.ts" "security/*.test.ts"`).
2. **Pure core, thin shell.** `frontmatter.ts`, `match.ts` and `engine.ts`
   never import pi. They receive plain data and return plain data — which makes
   them trivially unit-testable. Only `index.ts` (the "shell") imports pi and
   wires events to the core.
3. **Markdown is the context; YAML is the behavior.** The frontmatter never
   reaches the LLM. The body is the content — and it is injected only when the
   rule fires.

## Data flow

```text
.pi/context/*.md
        │  (session start, or /nma reload)
        ▼
  security gate (securityGate, index.ts)
        │  • scan: decode (depth 4), unicode, hidden Markdown,
        │    prompt-injection signatures, external refs, frontmatter
        │  • aggregate → none/low/medium/high/critical
        │  • trust store (path + SHA-256) + provenance + nudge
        │  • critical → blocked; medium/high → confirm; scan error → high
        ▼
  frontmatter.ts  ──►  engine.ts: loadContextDir()
        │                • parse frontmatter (YAML subset)
        │                • validate: known event? compatible action?
        │                • build Rule[] (bad file → skipped + message)
        ▼
        Rule[]  ──►  match.ts: matchRule(subject, match)
        │               • 10 match keys (input, tool, command, result,
        │                 model, cwd, sessionSize, contextFill, source, any)
        ▼
  engine.ts: selectForEvent(rules, subject, event)
        │               • filter by event + match, sort by priority
        ▼
  index.ts: handlers (pi.on(...))      index.ts: /nma command
     • build Subject (enriched with    • list / reload / status / security /
       model, cwd, sessionSize,          share / trust / untrust
       contextFill from the context)   • backed by the activity journal
     • action barrier (securityBarrier)  (capped at 100 entries)
       scans tool input before user
       rules run (tool_call, user_bash)
     • apply actions (inject, confirm,
       block, modify, tools, notify,
       transform, handled, annotate)
```

The security layer (`security/`) is a double barrier: **barrier A** (the
load-time gate above) filters content before parsing, and **barrier B** (the
action barrier) guards tool actions while at least one loaded rule file is
not yet trusted. Both are fail-closed. See
[Security model](security.md) for the full mechanics.

## The Subject

Every event gives pi a different payload. The engine normalizes it into a
`Subject` — the single object the matcher sees:

```ts
type Subject = {
  text: string;          // prompt / args JSON / raw input / command
  tool?: string;         // tool name
  command?: string;      // shell command
  result?: string;       // tool output text (tool_result)
  source?: string;       // interactive | rpc | extension (input)
  model?: string;        // "provider/id"
  cwd?: string;
  sessionSize?: number;  // session entries
  contextFill?: number;  // context usage %
};
```

Building it is the *only* place pi's types leak into the core — and it happens
in `index.ts`, never in the pure modules.

## Extension points

Adding a capability is a small, contained change:

| Want to add… | Touch | Notes |
| --- | --- | --- |
| A new **event** | `index.ts` (handler + subject), `engine.ts` (`VALID_EVENTS`, compat table) | also the skill + reference |
| A new **action** | `engine.ts` (union type, compat table), `index.ts` (switch cases) | validation comes free |
| A new **match key** | `match.ts` (`matchRule`), the `Subject` type | semantics doc'd in reference |
| A new **/nma subcommand** | `index.ts` (handler) | list/reload/status/import/convert/share/security/trust/untrust as pattern |
| AGENTS.md conversion (`/nma convert`) | `convert.ts` (pure) + `index.ts` (branch) | `parseSections`/`slugify`/`assignNames`/`buildPlan`/`buildBrief`; the brief reaches the agent via `pi.sendUserMessage` (triggers a turn); no rule files are written by the command |
| A new **scan family** | `security/rules.ts` (signature), `security/scan.ts` (pipeline hook) | calibration corpus (see below) is the gate |
| A new **decoder** | `security/encoding.ts` (decoder + round-trip check) | depth-capped, exhaustion signaled |
| A new **network signal** | `security/npm.ts` or `security/urlhaus.ts` | fail to `unknown`, never `safe` |

Because validation lives in the pure `engine.ts`, a new action or event is
enforced at parse time — an incompatible rule file fails loudly with a message
naming the file, instead of silently misbehaving.

## Deliberate simplifications

- **Injection via system prompt / user message, not a dedicated channel.**
  Context is appended to the system prompt (`before_agent_start`) or queued as
  a user message (`tool_call`, `tool_result`, delivered on the `context`
  event). Every injected body is wrapped in a
  `<user-context source="<rule name>">…</user-context>` delimiter (three
  injection sites share the same wrapper), so model and tool output can
  distinguish rule-supplied context from other content. It is the standard pi
  context-injection shape. A future `position: message` variant is on the
  roadmap.
- **`once` is per-rule-name per-session**, tracked in a `Set`. No cross-session
  persistence.
- **No file watching.** Rules reload on `/nma reload` (or restart). A watcher
  is on the roadmap.
- **`confirm` fail-safe:** no UI → block. This is a security property, not a
  convenience — it never flips to allow.
- **`tools` on a tool name that doesn't exist** is ignored by pi (unknown
  names are dropped); rules stay harmless.

## Testing

```bash
cd .pi/extensions/context-engine && node --test "*.test.ts" "security/*.test.ts"
```

The suite (468 tests across 19 files) covers the parser, the matcher, the
engine validation, the security scanner (decode, unicode, rules, commands,
network, trust, calibration), and — through a fake-pi harness in
`index.test.ts` — every event handler and the `/nma` command. The fake-pi
harness is the same file the E2E behavior is defined against, so a failing
test means a real behavior broke.

The security corpus adds its own permanent gate: 85 fixture Markdown files in
`security/fixtures/` with expected levels in `expected.json`
(`calibration.test.ts`) — benign ≤ `low`, false-positives ≤ `medium`,
malicious ≥ `high`. A new scanner rule or signature must keep the corpus
green. One caveat: the perf budget test (`security/perf.test.ts`, 100 files
< 300 ms) can fail under heavy parallel `node --test` load — run it in
isolation (`node --test security/perf.test.ts`) if it flakes.
