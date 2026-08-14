# Frontmatter schema

Every rule file starts with a `---`-delimited YAML block. Unknown keys are
ignored (tolerated), so older examples keep working.

| Key | Required | Type | Meaning |
| --- | --- | --- | --- |
| `name` | yes | string | Unique rule id. Used as section header in injected context and in block reasons. |
| `description` | no | string | Shown to the user / used as block reason fallback. |
| `events` | yes | string[] | One or more of the 7 valid events (see events.md). |
| `match` | no | map | When the rule applies. Absent = always. See matching.md. |
| `action` | yes | map | What happens when it applies. See actions.md. |
| `priority` | no | `high` \| `normal` \| `low` | `high`=3, `normal`=2, `low`=1. Rules run priority-desc. Default `normal`. |

## Events (7)

`before_agent_start` · `tool_call` · `tool_result` · `input` · `user_bash` ·
`session_before_switch` · `session_before_fork`

Every event in `events` must be one of these, and the action must be allowed
for that event — the loader rejects the file otherwise.

## Actions (9)

`inject` · `confirm` · `block` · `modify` · `tools` · `notify` · `transform` ·
`handled` · `annotate`

```yaml
action: {type: inject, once: true}                    # inject (once per session, default false)
action: {type: confirm, message: "..."}               # confirm / block (optional message)
action: {type: block, message: "..."}
action: {type: modify, command: {append: "...", prepend: "..."}}
action: {type: tools, enable: [x], disable: [y]}      # at least one of the two
action: {type: notify, message: "...", level: warning}  # level: info|warning|error (default info)
action: {type: transform, text: "new text"}           # input only
action: {type: handled}                               # input only
action: {type: annotate, append: "...", details: {...}}  # tool_result only
```

Note: the key is `level` (not `type`) for the notify variant — `type` is
already the action discriminator.

## Load-time validation

- `events`: not empty, every event must be known (error otherwise, with the
  list of valid events).
- `action.type`: known **and compatible with every listed event** (error
  otherwise, with the actions allowed for that event).
- A file without frontmatter is inert documentation (ignored).

Example:

```yaml
---
name: ui-context
description: UI conventions
events: [before_agent_start]
match:
  input: {contains: [ui, ux]}
action:
  type: inject
  once: true
priority: normal
---
```

The Markdown body after the closing `---` is the injected context. For guard
rules (`confirm`, `block`) the body is unused and may be empty.
