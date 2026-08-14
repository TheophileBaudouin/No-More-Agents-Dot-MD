# Examples

## 1. Always-on conventions (every matching prompt, once per session)

```markdown
---
name: ui-context
events: [before_agent_start]
match:
  input: {contains: [ui, ux, "interface utilisateur"]}
action: {type: inject, once: true}
---

# UI Conventions

- Reuse existing components.
- French UI strings, English identifiers.
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
  message: "Commande Git potentiellement destructive."
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

For guard rules the body is unused; keep it empty.
