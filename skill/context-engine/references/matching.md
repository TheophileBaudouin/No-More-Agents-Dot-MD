# Matching

`match` is optional; absent = the rule always applies. All text comparisons are
case-insensitive substrings unless a `regex` is given.

| Key | Applies to | Form |
| --- | --- | --- |
| `input` | prompt text (before_agent_start), arguments JSON (tool_call, tool_result) | string \| string[] \| `{contains: [...]}` \| `{regex: [...]}` \| list of these forms |
| `command` | `input.command` (bash-like tools, user_bash) | same forms as `input` |
| `tool` | tool name (tool_call, tool_result) | string \| string[] |
| `result` | tool text output (tool_result) | same forms as `input` |
| `model` | active model `provider/id` (all events) | string \| string[] — contains, case-insensitive |
| `cwd` | project path (all events) | same forms as `input` |
| `sessionSize` | session entry count (all events) | number = minimum (>=); or `{min: n, max: n}` |
| `contextFill` | context usage in % (all events) | number = minimum (>=); or `{min, max}` |
| `source` | input origin (input) | string \| string[] — exact equality: interactive \| rpc \| extension |
| `any` | the whole rule | list of sub-specs; if ONE matches, the rule matches immediately |

Semantics:

- Combined keys = AND (all must match). `any` ORs with the rest of the rule:
  if any sub-spec matches, the rule matches immediately; otherwise the
  remaining keys still apply as a normal AND.
- Inside a pattern object, `contains` and `regex` are OR; each list is any-of.
  `{contains: [ui, ux]}` matches "ui" or "ux".
- `regex` is anchored as written: use `^` for command starts (`"^git push"`),
  and watch out for `--force` variants (`"^git push --force"`).
- `sessionSize` / `contextFill`: a bare number means "at least this
  threshold"; `{min: 5, max: 200}` bounds inclusively. When the data is
  unavailable (e.g. unknown percent), the key does not match.
- `model`: matches by substring on `provider/id` — `anthropic` matches
  `anthropic/claude-sonnet-4`, and `claude-sonnet-4` matches too.

Example — bash guard:

```yaml
match:
  tool: bash
  command:
    regex: ["^git push", "^git reset --hard"]
```

Example — heterogeneous OR:

```yaml
match:
  any:
    - input: {contains: ["test"]}
    - tool: bash
```

Example — reacting to tool output:

```yaml
match:
  tool: bash
  command: {contains: ["pytest"]}
  result: {contains: ["FAILED"]}
```

Example — only on one project, when context usage is high:

```yaml
match:
  cwd: {contains: ["my-project"]}
  contextFill: 80
```
