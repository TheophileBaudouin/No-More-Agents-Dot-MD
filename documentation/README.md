# No More Agents Dot MD — human documentation

Welcome! This folder explains **No More Agents Dot MD** the same way a
good README would — no prior knowledge required. If you are brand new to this
idea, start here. If you are an expert, jump straight to the
[reference](reference.md).

## What problem does this solve?

When you work with an AI coding agent, you usually tell it about your project
in a single giant file (`AGENTS.md`, `CLAUDE.md`, …). That file gets longer and
longer, mixes things of very different importance, and the agent has to read
**everything** — even the parts that have nothing to do with what you are doing
right now.

This project replaces the monolith with **tiny context files**: one file per
topic (UI conventions, git safety, testing style…), each with a small
description of **when it applies**. The engine decides, for every event in your
session, which files actually matter — and only injects those.

> **The idea in one sentence:** a rule file describes *behavior* in its YAML
> frontmatter (event → match → action), and the *context* itself lives in the
> Markdown body, injected only when the rule fires.

## A quick example

File `.pi/context/ui.md`:

```markdown
---
name: ui-conventions
description: Inject UI/UX conventions when the conversation is about the UI
events: [before_agent_start]
match:
  input: {contains: ["ui", "component", "style"]}
action:
  type: inject
priority: normal
---

# UI Conventions

- Reuse existing components in `src/lib/components/` before writing new ones.
- Use design tokens (colors, spacing, typography) — no hard-coded values.
```

That's it. The engine watches what happens, and when a prompt mentions "ui" or
"component", those conventions appear in the agent's context. When the prompt
is about something else, the agent never sees them.

## What can rules do?

| You want to… | Action | Event it hooks into |
| --- | --- | --- |
| Inject conventions, context | `inject` | `before_agent_start`, `tool_call`, `tool_result` |
| Ask for confirmation before something risky | `confirm` | `tool_call`, `user_bash`, session guards |
| Refuse something outright | `block` | `tool_call`, `user_bash`, session guards |
| Rewrite a command before it runs | `modify` | `tool_call`, `user_bash` |
| Rewrite what the user types | `transform` | `input` |
| Answer without calling the LLM | `handled` | `input` |
| Add guidance after a tool output | `annotate` | `tool_result` |
| Enable/disable tools by topic | `tools` | most events |
| Show a visual notification | `notify` | most events |

## Where to go next

- **[Installation](installation.md)** — install with one command and see your
  first rule run in under five minutes.
- **[Writing rules](writing-rules.md)** — the friendly guide to rule files:
  anatomy, the YAML you actually need, three worked examples.
- **[Examples](examples.md)** — ready-to-copy recipes: git safety, UI
  conventions, test guidance, prompt shorthand, session guards, notifications.
- **[Reference](reference.md)** — the complete schema: all 7 events, 9 actions,
  10 match keys, validation rules, the `/nma` command. For when you want the
  exact contract.
- **[Architecture](architecture.md)** — how the engine works under the hood,
  and how to extend it. For the curious and would-be contributors.
- **[Security model](security.md)** — how rule files and tool actions are
  scanned, scored and gated, with the honest limits.

## What this project is not

- It is **not** a replacement for your rules — it is a *framework* to write
  them in.
- It is **not** a "no AGENTS.md ever" dogmatic rule — the point is that you no
  longer *need* one monolith. (The project itself runs without one, as a proof.)
- It is **not** a general automation platform — it is deliberately small:
  20 source files (7 core + 13 security), zero runtime npm dependencies.
