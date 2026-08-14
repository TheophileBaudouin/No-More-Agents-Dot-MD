---
name: context-engine
description: Creates and edits .pi/context/*.md declarative behavior rules for the No More Agents Dot MD extension — conditional context injection, tool guards, confirmations, user-input transforms, post-tool guidance, session-change guards, tool toggling and notifications, managed via the /nma command. Use when asked to add project conventions (UI, git, testing, security), guardrails, or conditional context to a Pi project.
---

# No More Agents Dot MD

The **No More Agents Dot MD** extension turns `.pi/context/*.md` files into
behaviors: the YAML frontmatter describes when a rule applies and what it
does; the Markdown body is the context injected into the agent. The frontmatter
is never shown to the model — only the body is.

Rules are always user-created: the repository ships without `.pi/context/`.
Every rule file you write goes through the workflow below, which creates the
directory when it is missing.

## Capabilities

- **inject** — conditional context into the system prompt
  (`before_agent_start`) or queued for the next LLM call (`tool_call`,
  `tool_result`).
- **block / confirm** — guards on tools, on `!` / `!!` commands typed by hand,
  and on session changes (`/new`, `/resume`, `/fork`, `/clone`).
- **modify** — command patching (prepend/append).
- **tools** — enable/disable tools by context.
- **transform / handled** — rewrite or consume user input.
- **annotate** — react to tool output (test results, etc.).
- **notify** — visual feedback; the extension also notifies automatically when
  a rule injects or blocks.
- **`/nma`** — list, reload (no pi restart) and inspect rule state.

## Workflow

1. **Ensure the rules directory exists.** If `.pi/context/` is missing at the
   project root, create it (`mkdir -p .pi/context`). Done when the directory
   exists — before any rule file is written.
2. **Pick the template** in `templates/` closest to the requested behavior.
   When no template fits, compose the rule from `references/` instead.
3. **Write the rule** as `.pi/context/<name>.md`: copy the template, fill in
   the frontmatter (`name`, `events`, `match`, `action`) and the body. Done
   when the rule passes schema validation — a known event, an action allowed
   for that event.
4. **Reload and confirm.** Tell the user to run `/nma reload` (or restart pi),
   then check the rule appears in `/nma`. Done when the user confirms the rule
   is listed.

## Minimal context

The body is the only context the agent sees — keep it minimal. Short
sentences. State only what changes behavior. Be precise: each line names
one concrete behavior. A line the agent would follow anyway is noise —
cut it.

## Rules of thumb

- YAML describes behavior; Markdown is the context. The body carries context
  only — logic belongs in the frontmatter.
- A file without frontmatter is inert documentation.
- Guard rules (`confirm`, `block`) need no Markdown body.
- Without a UI, `confirm` blocks fail-safe and `notify` shows nothing.
- Consult `references/` only when a template does not fit: `schema.md` (full
  reference), `matching.md` (how `match` works), `actions.md` (what actions
  do), `events.md` (which events exist and what they match against),
  `tool-hooks.md` (tool/session hooks in depth), `examples.md` (ready-made
  rules).
