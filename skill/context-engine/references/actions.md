# Actions

| Action | Events | Effect |
|--------|--------|--------|
| `inject` | before_agent_start, tool_call | Body appended to system prompt (agent start) or queued for the next LLM call (tool_call). |
| `confirm` | tool_call | `ctx.ui.confirm(name, message)`. Declined → tool blocked. Without UI, blocks fail-safe. |
| `block` | tool_call | Tool blocked with `message` (or name) as the reason. |
| `modify` | tool_call | Patches `input.command` in place: `command: {append: "...", prepend: "..."}`. |

`inject` options:

- `once: true` — inject only once per session (tracked per rule name).
- Without `once`, `before_agent_start` injects on every matching prompt — use
  `once` for conventions, plain inject for turn-specific reminders.

`confirm` / `block` need no Markdown body.

Security note: `confirm` is fail-safe. If pi has no UI (`ctx.hasUI === false`),
a confirm rule blocks rather than silently allowing.
