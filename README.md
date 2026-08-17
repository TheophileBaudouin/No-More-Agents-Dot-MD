![npm downloads](https://img.shields.io/npm/dm/no-more-agents-dot-md)

# No More Agents Dot MD

**Context at the right moment — not always.**

No More Agents Dot MD replaces the monolithic `AGENTS.md` with tiny, declarative context files (`.pi/context/*.md`), driven by a Pi extension. Each file is a micro-context: the YAML frontmatter describes *when* a rule applies and *what* it does; the Markdown body is the context the agent sees — injected only when it's relevant.

## The idea

This extension was born from [a video by Matt Pocock](https://youtu.be/9tmsq-Gvx6g?si=J_1MlTzlymxfOYd9) about the `/init` command. Its point: `/init` doesn't do magic — it just writes rules into an `AGENTS.md` file. Those rules then stay in the context **constantly**, even when they're useless for the task at hand.

The alternative in the video: **Claude Code's hooks** — instructions that fire at the right moment (before a tool call, after a result, when the user types…). Claude Code has them natively, and Pi extensions already exist to create hook-compatible files.

But stopping there felt like a shame: you'd only be able to produce files compatible with Claude Code — and never use the full power of the Pi SDK.

**No More Agents Dot MD goes all the way.** It is a native Pi extension built on 100% of the Pi SDK — itself far more permissive and granular than any hooks system — so your context is managed 100% by Pi, with a level of control that's impossible anywhere else:

- instructions arrive **at the right moment**, injected only when they apply;
- the agent sees **cleaner context** — no permanent noise in every prompt;
- rules can go further than injecting text: **block an action**, ask for a **confirmation**, transform an input, toggle tools;
- and you stay in control: write the rules by hand, or ask the agent — the built-in skill writes exactly the context file you need.

## How it works

```text
.pi/
├── context/                 # user-created — your behavior rules
└── extensions/
    └── context-engine/      # the extension (installed by pi)
        ├── index.ts         #   event wiring + /nma command
        ├── engine.ts        #   rule model + loader + validation
        ├── match.ts         #   declarative matcher
        ├── frontmatter.ts   #   YAML-subset parser
        └── security/        #   scan gate + action barrier + trust
            ├── scan.ts      #   scan pipeline (decode → rules → code)
            ├── rules.ts     #   prompt-injection signatures
            ├── commands.ts  #   shell pipeline analysis
            ├── encoding.ts  #   base64/hex/URL decoders
            ├── trust.ts     #   trust store (path + SHA-256)
            └── …            #   13 modules total
skill/context-engine/        # the skill (installed by pi)
```

`.pi/context/` is **yours** — the repository ships no rules. Create it with `mkdir -p .pi/context`, or ask the agent: the skill creates it for you.

**Security is built in.** Every rule file is scanned before it loads (obfuscation, prompt-injection, external refs, frontmatter-as-code) and gated through a trust store: `critical` is blocked, `medium`/`high` confirm, trusted files load silently. While any loaded file is not yet trusted, tool commands are scanned too. At the action barrier, commands containing public `http(s)` URLs can optionally be checked against URLhaus (`NMA_URLHAUS_KEY`); a listed host is treated as `critical` and terminal. Network checks never run at load time, and `NMA_NETWORK=0` disables them. See the [Security model](documentation/security.md) for the honest limits.

## Install

```bash
pi install npm:no-more-agents-dot-md
```

Or from git:

```bash
pi install git:github.com/TheophileBaudouin/No-More-Agents-Dot-MD
```

Restart pi in a project. With no rules yet, the engine loads silently — it
only logs when rules exist (e.g. `[No More Agents Dot MD] 2 rule(s) loaded
from .pi/context/`). That silence is normal: rules are user-created, the
repository ships none.

## Write a rule

Ask the agent ("add a context rule for X"): the skill picks the closest template and writes the rule. Or write one by hand:

```yaml
---
name: git-safety
description: Confirm before destructive git commands
events: [tool_call]
match:
  tool: bash
  command:
    regex: ["^git push", "^git reset --hard"]
action:
  type: confirm
  message: "Potentially destructive git command."
priority: high
---
```

Reload with `/nma reload` — no restart needed. Full schema in `skill/context-engine/references/schema.md`.

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

**Match on:** `input`, `command`, `tool`, `any` — plus `model` (active model), `cwd` (project path), `sessionSize`, `contextFill` (context usage %), `result` (tool output), `source` (input origin).

**Actions:** `inject` (once per session), `confirm` (fail-safe without UI), `block`, `modify` (command append/prepend), `tools` (enable/disable pi tools), `notify` (visual feedback), `transform` (rewrite input), `handled` (answer without the LLM), `annotate` (append to a tool result).

## Manage rules with /nma

- `/nma` — list the loaded rules (name, events, action, priority, file).
- `/nma reload` — reload `.pi/context/` without restarting pi.
- `/nma status` — what fired this session (injections, blocks, journal).
- `/nma security` — per-file scan level, load state, trust state, command guard ON/OFF.
- `/nma trust <file> [--yes]` — scan + approve a rule file; `/nma untrust <file>` — revoke.
- `/nma import <name|keywords> [--yes]` — search the [community registry](https://theophilebaudouin.github.io/awesome-No-More-Agents-Dot-MD/) by name or keywords (name, tags, category, author) and import a context file into `.pi/context/`. An exact name match imports directly; keyword matches with multiple results open a picker (or a numbered list without a UI). Imported files go through the same security scan and trust flow as local files; `--yes` answers the high/critical and overwrite confirmations when there is no UI.
- `/nma share` — open the community submission form.

## Share your rules

Found a rule worth keeping? Share it. **Awesome No-More-Agents-Dot-MD** is the community registry of Pi context files — a website to browse, submit and share them in a few clicks:

- **Site:** <https://theophilebaudouin.github.io/awesome-No-More-Agents-Dot-MD/>
- **Repository:** <https://github.com/TheophileBaudouin/awesome-No-More-Agents-Dot-MD>

## Documentation

- [documentation/](documentation/) — the human guide: [installation](documentation/installation.md), [writing rules](documentation/writing-rules.md), [examples](documentation/examples.md), [reference](documentation/reference.md), [architecture](documentation/architecture.md), [security model](documentation/security.md).
- The skill in `skill/context-engine/` is the documentation for the LLM.

## Verify

With a few rules of your own (see the [examples](documentation/examples.md)):

- "improve the ui" → the UI conventions appear in the system prompt.
- `git push` → pi asks for confirmation, and a warning notification appears.
- `pytest -x` → testing conventions show up right after the result.
- `!review` → the input is rewritten into a full code-review request.
- A failing test run → the result carries the focused-test guidance.
- `/nma` → the loaded rules are listed.

## Test

```bash
cd .pi/extensions/context-engine && node --test "*.test.ts" "security/*.test.ts"
```

Zero runtime npm dependencies (native `fetch` for the optional network
signals); runs on Node ≥ 22.6 (native TS type-stripping).

## What a context file looks like

<img src="assets/image.png" alt="A context file: YAML frontmatter and Markdown body" width="700"/>

## License

[MIT](LICENSE)
