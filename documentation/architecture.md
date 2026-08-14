# Architecture — how the engine works

This page is for the curious and for contributors. It explains the design
decisions, the data flow, and how to extend the engine. If you just want to
*write rules*, you don't need this — see [Writing rules](writing-rules.md).

## Design goals

1. **Zero npm dependencies.** The YAML frontmatter is parsed by a hand-written
   YAML-subset parser (~100 lines) — no YAML library, no framework. The whole
   engine is 4 source files and runs on Node ≥ 22.6 (native TS type-stripping,
   tests via `node --test "*.test.ts"`).
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
     • build Subject (enriched with    • list / reload / status
       model, cwd, sessionSize,        • backed by the activity journal
       contextFill from the context)     (capped at 100 entries)
     • apply actions (inject, confirm,
       block, modify, tools, notify,
       transform, handled, annotate)
```

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
| A new **/nma subcommand** | `index.ts` (handler) | list/reload/status as pattern |

Because validation lives in the pure `engine.ts`, a new action or event is
enforced at parse time — an incompatible rule file fails loudly with a message
naming the file, instead of silently misbehaving.

## Deliberate simplifications

- **Injection via system prompt / user message, not a dedicated channel.**
  Context is appended to the system prompt (`before_agent_start`) or queued as
  a user message (`tool_call`, `tool_result`, delivered on the `context`
  event). It is the standard pi context-injection shape. A future
  `position: message` variant is on the roadmap.
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
cd .pi/extensions/context-engine && node --test "*.test.ts"
```

The suite (63 tests at v2) covers the parser, the matcher, the engine
validation, and — through a fake-pi harness in `index.test.ts` — every event
handler and the `/nma` command. The fake-pi harness is the same file the E2E
behavior is defined against, so a failing test means a real behavior broke.
