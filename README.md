# no-agents dot md

Replace the monolithic `AGENTS.md` with tiny declarative context files
(`.pi/context/*.md`) driven by a Pi extension. Each file is a micro-context:
the YAML frontmatter describes the behavior, the Markdown body is the context
the agent actually sees — injected only when it applies.

```text
.pi/
├── context/                 # behavior rules (copy into your project)
│   ├── ui.md                #   conditional context on UI/UX prompts
│   ├── git-safety.md        #   confirm destructive git commands
│   ├── test-context.md      #   testing conventions after a test run
│   ├── input.md             #   rewrite a shorthand prompt (input transform)
│   ├── tool-result.md       #   annotate test failures (tool_result)
│   ├── tools.md             #   example: enable a tool by topic (tools)
│   ├── session-guard.md     #   confirm before forking the session
│   └── notify.md            #   visible notification when a rule applies
└── extensions/
    └── context-engine/      # the extension (copy into your project)
        ├── index.ts         #   event wiring + /nma command
        ├── engine.ts        #   rule model + loader + validation
        ├── match.ts         #   declarative matcher
        └── frontmatter.ts   #   YAML-subset parser
skill/context-engine/        # the skill (copy to ~/.pi/agent/skills/)
```

## Install

1. Copy the extension into your project:

   ```bash
   cp -r .pi/extensions/context-engine <project>/.pi/extensions/
   ```

2. Copy (or adapt) the example rules:

   ```bash
   cp -r .pi/context <project>/.pi/context
   ```

3. Install the skill globally:

   ```bash
   cp -r skill/context-engine ~/.pi/agent/skills/
   ```

4. Restart pi in the project. You should see:

   ```text
   [context-engine] 8 rule(s) loaded from .pi/context/
   ```

## Write a rule

Copy the closest template from `skill/context-engine/templates/` into
`.pi/context/<name>.md`, fill it in, then reload with `/nma reload` (no
restart needed). Full schema in `skill/context-engine/references/schema.md`.

## Manage rules with /nma

- `/nma` — list the loaded rules (name, events, action, priority, file).
- `/nma reload` — reload `.pi/context/` without restarting pi.
- `/nma status` — what fired this session (injections, blocks, journal).

## What a rule can do (v2)

| Event | Subject matched | Actions |
|-------|-----------------|---------|
| `before_agent_start` | prompt text | inject, tools, notify |
| `tool_call` | tool name, input JSON, command | block, confirm, modify, inject, tools, notify |
| `tool_result` | tool name, output text (`result`) | annotate, inject, notify |
| `input` | raw user input, source | transform, handled, tools, notify |
| `user_bash` | `!` / `!!` command | block, confirm, modify, notify |
| `session_before_switch` | reason (`new`/`resume`) | confirm, block, notify |
| `session_before_fork` | position (`before`/`at`) | confirm, block, notify |

Match keys: `input`, `command`, `tool`, `any` + `model` (active model),
`cwd` (project path), `sessionSize` (session size), `contextFill` (context
usage %), `result` (tool output), `source` (input origin).

Actions: `inject` (once per session), `confirm` (fail-safe without UI),
`block`, `modify` (command append/prepend), `tools` (enable/disable pi
tools), `notify` (visual feedback), `transform` (rewrite input), `handled`
(answer without the LLM), `annotate` (append to a tool result).

## Verify

- "improve the ui" → the UI conventions appear in the system prompt.
- `git push` → pi asks for confirmation, and a warning notification appears.
- `pytest -x` → testing conventions show up right after the result.
- `!review` → the input is rewritten into a full code-review request.
- A failing test run → the result carries the focused-test guidance.
- `/nma` → the loaded rules are listed.

## Test

```bash
cd .pi/extensions/context-engine && node --test "*.test.ts"
```

Zero npm dependencies; runs on Node ≥ 22.6 (native TS type-stripping).

## Roadmap

- File watching (reload rules on change instead of `/nma reload`).
- `position: message` injection (a real injected message, not system prompt).
- A `context_rules` tool the LLM can call to discover active rules.
- A `git` match dimension (repo state — needs `exec`, breaks engine purity).
