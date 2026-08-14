---
name: context-engine
description: Creates .pi/context/*.md declarative behavior rules for the Pi context-engine extension — conditional context injection, tool guards, confirmations, post-tool guidance. Use when asked to add project conventions (UI, git, testing, security), guardrails, or conditional context to a Pi project.
---

# Context Engine

The `context-engine` Pi extension turns `.pi/context/*.md` files into behaviors:
the YAML frontmatter describes WHEN a rule applies and WHAT it does; the Markdown
body is the context injected into the agent. The frontmatter is never shown to
the model — only the body is.

## Workflow

1. Pick the template in `templates/` closest to the requested behavior.
2. Copy it to `.pi/context/<name>.md` and fill in the frontmatter + body.
3. Tell the user to restart pi (rules load at `session_start`).

## Rules of thumb

- YAML describes behavior; Markdown is the context. Never put logic in the body.
- A file without frontmatter is inert documentation.
- Guard rules (`confirm`, `block`) need no Markdown body.
- Consult `references/` only when a template doesn't fit: `schema.md` (full
  reference), `matching.md` (how `match` works), `actions.md` (what actions do),
  `events.md` (which events exist and what they match against).
