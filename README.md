# No More Agents Dot MD

Replace the monolithic `AGENTS.md` with tiny declarative context files
(`.pi/context/*.md`) driven by a Pi extension. Each file is a micro-context:
the YAML frontmatter describes the behavior, the Markdown body is the context
the agent actually sees — injected only when it applies.

> **Documentation for humans:** [documentation/](documentation/) — a full,
> beginner-friendly guide: [installation](documentation/installation.md),
> [how to write rules](documentation/writing-rules.md),
> [ready-to-copy examples](documentation/examples.md),
> [complete reference](documentation/reference.md), and
> [architecture](documentation/architecture.md).
> (The skill in `skill/context-engine/` is the documentation for the LLM.)

```text
.pi/
├── context/                 # user-created — your behavior rules (see documentation/)
└── extensions/
    └── context-engine/      # the extension (installed by pi)
        ├── index.ts         #   event wiring + /nma command
        ├── engine.ts        #   rule model + loader + validation
        ├── match.ts         #   declarative matcher
        └── frontmatter.ts   #   YAML-subset parser
skill/context-engine/        # the skill (installed by pi)
```

`.pi/context/` is **yours**: the repository ships no rules. Create it with
`mkdir -p .pi/context` — or ask the agent for a rule; the `context-engine`
skill creates the directory automatically.

## Install

### One command (recommended)

The repository is a pi package: it installs the **extension** and the **skill**
in one command, available in every project:

```bash
pi install git:github.com/TheophileBaudouin/No-More-Agents-Dot-MD
```

or with HTTPS: `pi install https://github.com/TheophileBaudouin/No-More-Agents-Dot-MD`

Then restart pi in a project. A fresh install shows:

```text
[context-engine] 0 rule(s) loaded from .pi/context/
```

That is normal: rules are user-created, the repository ships none. Ask the
agent for your first rule ("add a context rule for X") — the `context-engine`
skill creates `.pi/context/` automatically — or follow
[writing-rules](documentation/writing-rules.md).

### Manual install

1. Copy the extension into your project:

   ```bash
   cp -r .pi/extensions/context-engine <project>/.pi/extensions/
   ```

2. Create the rules directory in your project:

   ```bash
   mkdir -p .pi/context
   ```

   (Or skip it: the `context-engine` skill creates it when you ask the agent
   for a rule.)

3. Install the skill globally:

   ```bash
   cp -r skill/context-engine ~/.pi/agent/skills/
   ```

4. Restart pi in the project. You should see:

   ```text
   [context-engine] 0 rule(s) loaded from .pi/context/
   ```

   `0 rule(s)` is normal — the count goes up as you write rules.

## Write a rule

Rules are user-created — nothing ships in `.pi/context/`. Ask the agent
("add a context rule for X"): the `context-engine` skill creates `.pi/context/`
if missing, picks the closest template from its `templates/`, and writes the
rule. Or write one by hand following [writing-rules](documentation/writing-rules.md).
Reload with `/nma reload` (no restart needed). Full schema in
`skill/context-engine/references/schema.md`.

## Manage rules with /nma

- `/nma` — list the loaded rules (name, events, action, priority, file).
- `/nma reload` — reload `.pi/context/` without restarting pi.
- `/nma status` — what fired this session (injections, blocks, journal).

## What a rule can do

| Event | Subject matched | Actions |
| --- | --- | --- |
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

With a few rules of your own (e.g. from the [examples](documentation/examples.md)):

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
