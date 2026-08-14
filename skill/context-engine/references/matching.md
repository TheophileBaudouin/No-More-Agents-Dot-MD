# Matching

`match` is optional; absent = the rule always applies. All text comparisons are
case-insensitive substrings unless a `regex` is given.

| Key | Applies to | Shape |
|-----|-----------|-------|
| `input` | prompt text (before_agent_start) or tool input JSON (tool_call) | string \| string[] \| `{contains: [...]}` \| `{regex: [...]}` \| list of these |
| `command` | `input.command` string (bash-like tools) | same shapes as `input` |
| `tool` | tool name (tool_call) | string \| string[] |
| `any` | whole rule | list of sub-specs; if ANY matches, the rule matches immediately |

Semantics:

- Inside one pattern object, `contains` and `regex` are OR'd; each list is
  any-of. `{contains: [ui, ux]}` matches "ui" or "ux".
- `regex` entries are anchored as written: use `^` for command starts
  (`"^git push"`), and mind `--force` variants (`"^git push --force"`).
- Example — bash guard:

```yaml
match:
  tool: bash
  command:
    regex: ["^git push", "^git reset --hard"]
```

- Example — OR across heterogeneous specs:

```yaml
match:
  any:
    - input: {contains: ["test"]}
    - tool: bash
```
