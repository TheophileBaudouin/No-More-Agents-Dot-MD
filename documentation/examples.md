# Examples — ready-to-copy recipes

Every recipe below is a complete `.pi/context/<name>.md` file. Copy, adapt,
save, then `/nma reload`. The repository ships **no** rules: `.pi/context/` is
entirely yours — create it with `mkdir -p .pi/context` (or ask the agent; the
`no-more-agents-dot-md` skill creates it automatically), then add the rules that fit
your project.

---

## 1. UI conventions (conditional context)

Inject your design rules only when the conversation touches the UI.

```markdown
---
name: ui-conventions
description: Inject UI/UX conventions when the conversation is about the UI
events: [before_agent_start]
match:
  input: {contains: ["ui", "component", "style", "design"]}
action:
  type: inject
priority: normal
---

# UI Conventions

- Reuse existing components in `src/lib/components/` before writing new ones.
- Use design tokens (colors, spacing, typography) — no hard-coded values.
```

## 2. Git safety (confirm)

Ask before any potentially destructive git command. Without a UI (headless),
this **blocks** — it never silently allows.

```markdown
---
name: git-safety
description: Confirm destructive git commands
events: [tool_call]
match:
  tool: bash
  command:
    regex: ["^git push", "^git reset --hard", "^git clean -f", "^git rebase -i"]
action:
  type: confirm
  message: "Potentially destructive git command."
priority: high
---

```

## 3. Testing guidance (inject after a test run)

The guidance lands in context exactly when the agent is interpreting test
output.

```markdown
---
name: test-conventions
description: Testing conventions after a test run
events: [tool_result]
match:
  tool: bash
  command:
    contains: ["pytest", "vitest", "go test", "node --test"]
action:
  type: inject
priority: normal
---

# Testing conventions

- Run the targeted test first (`pytest tests/x.py::test_name`).
- Fix only the failing case, then re-run the full file.
```

## 4. Annotate a failing test (tool_result + annotate)

Instead of injecting context, *append a hint to the tool's output itself*.

```markdown
---
name: test-failure-guidance
description: Guidance appended when a test fails
events: [tool_result]
match:
  tool: bash
  command:
    contains: ["pytest", "vitest", "go test"]
  result:
    contains: ["FAILED", "Error"]
action:
  type: annotate
  append: "Test failed — re-run the targeted test, fix only that case, then the full file."
---

```

## 5. Prompt shorthand (input + transform)

The LLM never sees the shorthand; it sees the expanded request.

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

## 6. "Handled" without the LLM (input + handled)

Answer cheap, well-defined questions without consuming a model call. The rule
must be `priority: high` and only for questions with a single deterministic
answer.

```markdown
---
name: nma-help
description: Explain /nma without calling the LLM
events: [input]
match:
  input:
    contains: ["/nma help", "what does nma do"]
action:
  type: handled
priority: high
---

/nma lists loaded rules, /nma reload re-reads .pi/context/, /nma status shows session activity.
```

## 7. Session guard (confirm before /fork)

```markdown
---
name: fork-guard
description: Confirm before forking the session
events: [session_before_fork]
action:
  type: confirm
  message: "Fork the session? The abandoned branch will be summarized."
priority: high
---

```

## 8. Notifications (notify)

Get told in the UI when a rule is about to act — great paired with guards.

```markdown
---
name: git-notify
description: Notify when a git push is attempted
events: [tool_call]
match:
  tool: bash
  command:
    regex: ["^git push"]
action:
  type: notify
  message: "git push detected — the git-safety rule will ask for confirmation."
  level: warning
---

```

## 9. Enable a tool by topic (tools)

Example only — enable a hypothetical `commit_message_gen` tool when the user
asks about commit messages. Note the shape: `enable`/`disable` take tool
names. Prefer `enable` (additive) over `disable` (riskier).

```markdown
---
name: tools-example
description: Enable commit_message_gen when commit messages come up
events: [before_agent_start]
match:
  input: {contains: ["commit message", "conventional commits"]}
action:
  type: tools
  enable: [commit_message_gen]
priority: high
---

```

## 10. Model-aware behavior (match on model)

Different behavior depending on the model in use — e.g. cheaper conventions
for the fast model.

```markdown
---
name: fast-model-budget
description: Tighter scope on fast models
events: [before_agent_start]
match:
  model: {contains: ["flash", "v4-flash"]}
action:
  type: inject
priority: normal
---

# Fast-model scope

Keep answers short. No exploratory code, no multi-step plans. Deliver the
smallest correct change and stop.
```

---

## Combining rules

Rules compose naturally. `git-safety` + `git-notify` is a classic pair: the
guard blocks, the notification explains why, and both can live in separate
files. There is no limit on the number of rules per event.
