# Tool hooks in depth

## tool_call

`tool_call` rules run in priority order (high → low). The first `block` return
wins and stops the loop; `confirm` approvals, `modify` patches, `inject`
queues, `tools` toggles and `notify` calls all accumulate before the tool
executes.

Execution guarantees (pi SDK):

- `event.input` is mutable; patches affect the real execution. No re-validation
  happens after mutation.
- `{ block: true, reason }` cancels the tool.
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

## tool_result

Fires after the tool executed, before the result is finalized. Rules can:

- `annotate`: patches the result — `append` adds a text block to the output,
  `details` is merged into the details. The model sees the annotated text.
- `inject`: queues the body for the next LLM call (like tool_call).
- `notify`: visual feedback.

Match on the output via `result`:

```yaml
---
name: test-failure-guidance
events: [tool_result]
match:
  tool: bash
  command: {contains: ["pytest"]}
  result: {contains: ["FAILED"]}
action:
  type: annotate
  append: |
    Tip: run the isolated test before fixing.
---
```

## user_bash (`!` / `!!` commands)

Guards also apply to commands typed by hand.

- `block` → the command is replaced by an error result: output = rule message,
  `exitCode: 1`.
- `confirm` → dialog; declined = blocked. Without UI, blocks fail-safe.
- `modify` → the command is wrapped with `prepend` / `append` (via
  `createLocalBashOperations`).

## Session guards (`/new`, `/resume`, `/fork`, `/clone`)

`session_before_switch` (reason: new|resume) and `session_before_fork`
(position: before|at) can cancel a session change:

```yaml
---
name: session-guard
events: [session_before_fork]
action:
  type: confirm
  message: "Fork this session?"
priority: high
---
```

- `block` → `{cancel: true}`.
- declined `confirm` → `{cancel: true}`. Without UI → `{cancel: true}`
  (fail-safe).

## The `/nma` command

`/nma` manages rules from pi, without restarting:

- `/nma` — lists the rules (name, events, action, priority, file, match).
- `/nma reload` — reloads `.pi/context/` immediately.
- `/nma status` — session state: loaded rules, `once` injections, pending
  context, action journal (last 10).

## Notifications

When a rule injects or blocks (or a confirm is declined), a
`[nma] <name>: context injected` / `[nma] <name>: blocked` notification is
shown when pi has a UI. The `notify` action allows a custom message
(`level: info | warning | error`).
