# Writing rules — the friendly guide

A rule is a single Markdown file in `.pi/context/` (one file per topic). The
engine reads all of them at session start, and re-reads them on `/nma reload`.

## The anatomy of a rule file

```markdown
---
name: my-rule                      # unique name (used in logs, /nma, confirmations)
description: What this rule does   # shown by /nma, used as fallback message
events: [before_agent_start]       # when the rule is considered
match:                             # optional: if this matches → rule applies
  input: {contains: ["ui"]}
action:                            # what to do
  type: inject
priority: normal                   # low | normal | high — high wins on conflicts
---

# What the agent actually sees

Anything below this line is the **context**. It is injected into the agent
**only when the rule fires** (when `events` and `match` say so).

The frontmatter is NEVER injected. It describes behavior; the body is content.
```

Think of it as: **IF** `events` happen **AND** `match` fits **THEN** `action`
using the body as payload.

## The YAML you actually need

No YAML knowledge required — the engine uses a deliberately small subset:

| Shape | Example | Meaning |
| --- | --- | --- |
| Inline list | `events: [tool_call, tool_result]` | several values |
| Block list | `command:\n  contains:\n    - npm test` | a list with sub-values |
| Inline map | `match:\n  input: {contains: ["ui"]}` | key → value pair |
| Plain values | `priority: high` | a simple string/number |

That's it. If you know those four, you can write any rule.

## Rule of thumb: keep one rule = one topic

A file about UI conventions, a file about git safety, a file about testing.
Why? Because each file is only injected **when relevant**. The moment you merge
topics, the agent reads both together — and you have rebuilt a small monolith.

## Three worked examples

### 1. Conditional context (the most common case)

Inject a chunk of instructions only when the conversation touches the topic:

```markdown
---
name: test-conventions
description: Inject testing conventions when tests are involved
events: [tool_call, tool_result]
match:
  tool: bash
  command:
    contains: ["pytest", "vitest", "go test"]
action:
  type: inject
priority: normal
---

# Testing conventions

- Run the targeted test first: `pytest tests/x.py::test_name`.
- Never fix more than the failing case.
- Re-run the full file when done.
```

Why two events? The rule fires once at `tool_call` (the command is about to
run) **or** right after `tool_result` (the run just finished, so the guidance
lands in context exactly when the agent is about to interpret the output).

### 2. A safety guard

Refuse a destructive command with zero tolerance (no UI = it **blocks**, never
silently allows):

```markdown
---
name: git-safety
description: Block destructive git commands
events: [tool_call]
match:
  tool: bash
  command:
    regex: ["^git push", "^git reset --hard", "^git clean -f"]
action:
  type: confirm
  message: "Commande Git potentiellement destructive."
priority: high
---

```

Here the action is `confirm`: pi asks the human. Decline → blocked. The body
is empty: nothing to inject, the guard speaks for itself.

### 3. Rewrite what the user types

A personal shorthand that becomes a full instruction (the LLM never sees the
shorthand — it sees the replacement):

```markdown
---
name: review-shorthand
description: Turn "!review" into a full code-review request
events: [input]
match:
  input: {contains: ["!review"]}
action:
  type: transform
  text: "Review the last commit: read the diff, list bugs, style issues and missing tests, then propose precise fixes."
---

```

## Match keys — how rules decide to fire

Rules can listen on the event's *subject*:

| Key | What it looks at | Typical values |
| --- | --- | --- |
| `input` | the text: user prompt, tool arguments, command | string, list, `{contains: [...]}` |
| `command` | the shell command (bash events) | same forms as `input` |
| `tool` | the tool name | `bash`, `edit`, `read`… |
| `result` | the text output of a tool | same forms as `input` |
| `model` | the active model, `provider/id` | contains, case-insensitive |
| `cwd` | the current working directory | contains / exact |
| `sessionSize` | number of session entries | a number = "at least", or `{min, max}` |
| `contextFill` | context usage in % | a number = "at least", or `{min, max}` |
| `source` | where the input came from | `interactive`, `rpc`, `extension` (exact) |
| `any` | any of the above (OR) | a list of other match objects |

Every key accepts one of: a string (contains), a list of strings (contains
any), or `{contains: [...]}` / `{regex: [...]}` for explicit control.

## Common mistakes

- **Missing `events:`** — the file is loaded but never considered. The engine
  *does* warn about unknown/incompatible combinations at load time, so read the
  startup message.
- **Frontmatter typos** — an unknown event or an action that cannot run on that
  event makes the file **fail to load** (with a clear message). Fix and
  `/nma reload`.
- **One giant body** — if your body is 200 lines, split it into several rules
  with narrower matches. That's the whole point.
- **Expecting the frontmatter to reach the LLM** — it never does. If you want
  the agent to know a fact, put it in the **body**.

## Next

Browse ready-to-copy recipes in [Examples](examples.md), or go deep on the full
contract in [Reference](reference.md).
