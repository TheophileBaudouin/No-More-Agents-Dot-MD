# Events

A rule fires on the events listed in `events`. Each event exposes a different
"subject" that `match` runs against. All events also expose the session state
keys (`model`, `cwd`, `sessionSize`, `contextFill`).

| Event | Fires when | Match subject | Allowed actions |
| --- | --- | --- | --- |
| `before_agent_start` | after a prompt is submitted, before the agent loop | text = prompt; model, cwd, sessionSize, contextFill | inject, tools, notify |
| `tool_call` | before a tool executes | tool = name; text = arguments JSON; command; model, cwd, sessionSize, contextFill | block, confirm, modify, inject, tools, notify |
| `tool_result` | after a tool executed | tool; text = arguments JSON; command; **result** = text output; model, cwd, sessionSize, contextFill | annotate, inject, notify |
| `input` | on user input, before skill/template expansion | text = raw input; **source** = interactive\|rpc\|extension; model, cwd, sessionSize, contextFill | transform, handled, tools, notify |
| `user_bash` | on a `!` / `!!` command typed by hand | text = command; command; model, cwd, sessionSize, contextFill | block, confirm, modify, notify |
| `session_before_switch` | before `/new` or `/resume` | text = reason (new\|resume); model, cwd, sessionSize, contextFill | confirm, block, notify |
| `session_before_fork` | before `/fork` or `/clone` | text = position (before\|at); model, cwd, sessionSize, contextFill | confirm, block, notify |

## Per event

### before_agent_start

Fires after the user submits a prompt, before the agent loop.

- Subject text: the user's prompt (`event.prompt`).
- `inject` appends the body to the system prompt. `once: true` injects only on
  the first matching prompt of the session.
- `tools` / `notify` also apply here.

### tool_call

Fires before a tool executes. Can block, confirm, modify, queue guidance,
toggle tools, or notify.

- Subject: tool name (`event.toolName`), the tool input JSON, and `command`
  (the string value of `input.command` for bash-like tools).
- `inject` here means: queue the body, delivered before the next LLM call via
  the `context` event — guidance the model sees right after the tool result.

### tool_result

Fires after a tool executed, before the result is finalized.

- Subject: tool name, the tool input JSON, `command`, and `result` (the
  concatenated text output of the tool).
- `annotate` patches the result (append text, merge details).
- `inject` queues the body for the next LLM call (same delivery as tool_call).

### input

Fires on raw user input, before skill/template expansion.

- `transform` replaces the input text (rules chain in priority order — each
  transform rule replaces the current text).
- `handled` consumes the input: the agent does not run (first handled rule
  wins).
- `tools` / `notify` also apply.

### user_bash

Fires on `!` / `!!` commands typed by the user.

- Same guard semantics as `tool_call`: `block` / `confirm` / `modify` apply to
  the manual command.

### session_before_switch / session_before_fork

Fires before `/new`, `/resume`, `/fork`, `/clone`.

- `block` / declined `confirm` → `{cancel: true}`: the session action is
  cancelled.
