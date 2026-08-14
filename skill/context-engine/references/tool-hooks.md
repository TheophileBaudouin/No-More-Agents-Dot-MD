# Tool hooks in depth

`tool_call` rules run in priority order (high → low). The first `block` return
wins and stops the loop; `confirm` approvals, `modify` patches, and `inject`
queues all accumulate before the tool executes.

Execution guarantees (pi SDK):

- `event.input` is mutable; patches affect the real execution. No re-validation
  happens after mutation.
- `{ block: true, reason }` cancels the tool; add `terminate: true` to also end
  the agent turn.
- The `context` event fires before the next LLM call; queued `inject` bodies are
  appended there as a `user` message (drained once — one delivery per tool
  call; `AgentMessage` has no `system` role, so user is the injection shape).

Typical guard shape:

```yaml
---
name: dangerous-git
events: [tool_call]
match:
  tool: bash
  command: {regex: ["^git reset --hard"]}
action:
  type: confirm
  message: "Destructive git command."
priority: high
---
```

Future: `tool_result` reactions (annotate/summarize tool output).
