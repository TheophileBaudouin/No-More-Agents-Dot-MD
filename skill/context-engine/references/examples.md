# Examples

## 1. Always-on conventions (every matching prompt, once per session)

```markdown
---
name: ui-context
events: [before_agent_start]
match:
  input: {contains: [ui, ux, "user interface"]}
action: {type: inject, once: true}
---

# UI Conventions

- Reuse existing components.
- Keep user-visible text in English.
```

## 2. Confirm destructive git

```markdown
---
name: git-safety
events: [tool_call]
match:
  tool: bash
  command: {regex: ["^git push", "^git reset --hard", "^git push --force"]}
action:
  type: confirm
  message: "Potentially destructive git command."
priority: high
---
```

## 3. Hard-block a tool

```markdown
---
name: no-destructive-rm
events: [tool_call]
match:
  tool: bash
  command: {regex: ["rm -rf"]}
action:
  type: block
  message: "rm -rf is banned in this project."
---
```

## 4. Guidance after a test run (tool_call inject → next LLM call)

```markdown
---
name: test-context
events: [tool_call]
match:
  tool: bash
  command: {contains: ["pytest", "vitest", "go test"]}
action: {type: inject, once: true}
---

# Testing

- Run the focused test, not the whole suite.
```

## 5. OR across heterogeneous specs

```markdown
---
name: test-context
events: [tool_call, before_agent_start]
match:
  any:
    - input: {contains: ["test"]}
    - tool: bash
action: {type: inject}
---
```

## 6. Transform user input (input → transform)

Rewrite a raw input before the agent sees it:

```markdown
---
name: quick-answer
events: [input]
match:
  input: {contains: ["?quick "]}
action:
  type: transform
  text: "Answer briefly: {{text}}"   # placeholder: replace with the desired text
---
```

Note: `transform` replaces the whole input text (the `{{text}}` placeholder
is an example — the extension does no substitution, the text is static).

## 7. Handle input without the LLM (input → handled)

```markdown
---
name: ping
events: [input]
match:
  input: {contains: ["ping"]}
action: {type: handled}
---
```

`handled` consumes the input: the agent does not run (pair it with `notify`
to give the user visible feedback).

## 8. React to a test failure (tool_result → annotate)

```markdown
---
name: test-failure
events: [tool_result]
match:
  tool: bash
  command: {contains: ["pytest"]}
  result: {contains: ["FAILED"]}
action:
  type: annotate
  append: "Tip: run the isolated test first, then fix."
---

# (optional) Context added to the result

- This body is NOT injected for `annotate` — only `append` is.
```

## 9. Toggle tools by context (tools)

```markdown
---
name: secure-project
events: [before_agent_start]
match:
  cwd: {contains: ["sensitive-repo"]}
action:
  type: tools
  disable: [bash]
priority: high
---
```

## 10. Session guard (confirm before /fork)

```markdown
---
name: fork-guard
events: [session_before_fork]
action:
  type: confirm
  message: "Fork this session?"
priority: high
---
```

## 11. Notify when a rule acts

```markdown
---
name: git-alert
events: [tool_call]
match:
  tool: bash
  command: {contains: ["git push"]}
action:
  type: notify
  message: "Push detected."
  level: warning
---
```

For guard rules the body is unused; keep it empty.
