# Events

A rule fires on the events listed in `events`. Each event exposes a different
"subject" that `match` runs against.

## before_agent_start

Fires after the user submits a prompt, before the agent loop.

- Subject text: the user's prompt (`event.prompt`).
- Supported actions: `inject`.
- The injected body is appended to the system prompt. `once: true` injects
  only on the first matching prompt of the session.

## tool_call

Fires before a tool executes. Can block, confirm, modify, or queue guidance.

- Subject: tool name (`event.toolName`), the tool input JSON, and `command`
  (the string value of `input.command` for bash-like tools).
- Supported actions: `block`, `confirm`, `modify`, `inject`.
- `inject` here means: queue the body, delivered before the next LLM call via
  the `context` event — guidance the model sees right after the tool result.

## Future (not implemented in v1)

- `input` — raw user input before skill/template expansion (transform/handled).
- `tool_result` — react to tool output (modify/annotate results).

Files must list at least one implemented event; listing a future event is
currently accepted but has no effect.
