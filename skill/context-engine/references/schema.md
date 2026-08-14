# Frontmatter schema

Every rule file starts with a `---`-delimited YAML block. Unknown keys are
ignored (tolerated), so older examples keep working.

| Key | Required | Type | Meaning |
|-----|----------|------|---------|
| `name` | yes | string | Unique rule id. Used as section header in injected context and in block reasons. |
| `description` | no | string | Shown to the user / used as block reason fallback. |
| `events` | yes | string[] | `before_agent_start`, `tool_call`. (Future: `input`, `tool_result`.) |
| `match` | no | map | When the rule applies. Absent = always. See matching.md. |
| `action` | yes | map | What happens when it applies. See actions.md. |
| `priority` | no | `high` \| `normal` \| `low` | `high`=3, `normal`=2, `low`=1. Rules run priority-desc. Default `normal`. |

Example:

```yaml
---
name: ui-context
description: Conventions UI
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
