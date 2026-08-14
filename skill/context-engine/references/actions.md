# Actions

| Action | Events | Effect |
| --- | --- | --- |
| `inject` | before_agent_start, tool_call, tool_result | Body added to the system prompt (agent start) or queued for the next LLM call (tool_call, tool_result). |
| `confirm` | tool_call, user_bash, session_before_switch, session_before_fork | `ctx.ui.confirm(name, message)`. Declined → tool blocked / session cancelled. Without UI, blocks fail-safe. |
| `block` | tool_call, user_bash, session_before_switch, session_before_fork | Tool blocked (or session cancelled) with `message` (or name) as reason. |
| `modify` | tool_call, user_bash | Patches the command: `command: {append: "...", prepend: "..."}`. |
| `tools` | before_agent_start, tool_call, input | Enables/disables pi tools: `enable: [...]`, `disable: [...]` (at least one). |
| `notify` | all | `ctx.ui.notify(message, level)` — visual feedback. |
| `transform` | input | Replaces the input text with `text`. |
| `handled` | input | Consumes the input: the agent does not run. |
| `annotate` | tool_result | Patches the tool result: `append` (added text), `details` (merged). |

## Options per action

- `inject`: `once: true` — a single injection per session (tracked by rule
  name). Without `once`, `before_agent_start` injects on every matching prompt.
- `confirm` / `block`: optional `message` (displayed reason / block reason).
- `modify`: `command: {append?, prepend?}`.
- `tools`: `enable` (list of tool names) and/or `disable` (list) — the tool
  name must be registered in pi.
- `notify`: `message`, `level: info | warning | error` (default `info`).
- `transform`: `text` (required — new input text).
- `handled`: no options.
- `annotate`: `append` (text added to the output), `details` (object merged
  into the result details).

## Automatic notifications

Besides the `notify` action, when a rule **injects** or **blocks** (or a
confirm is declined), the extension shows `[No More Agents Dot MD] <name>: context injected` /
`[No More Agents Dot MD] <name>: blocked` when pi has a UI (`ctx.hasUI`). Without a UI nothing
is shown — and `confirm` blocks fail-safe.

## Event × action matrix

| | inject | confirm | block | modify | tools | notify | transform | handled | annotate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| before_agent_start | ✓ | | | | ✓ | ✓ | | | |
| tool_call | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | |
| tool_result | ✓ | | | | | ✓ | | | ✓ |
| input | | | | | ✓ | ✓ | ✓ | ✓ | |
| user_bash | | ✓ | ✓ | ✓ | | ✓ | | | |
| session_before_switch | | ✓ | ✓ | | | ✓ | | | |
| session_before_fork | | ✓ | ✓ | | | ✓ | | | |

`confirm` / `block` need no Markdown body.

Security note: `confirm` is fail-safe. If pi has no UI (`ctx.hasUI === false`),
a confirm rule blocks rather than silently allowing.
