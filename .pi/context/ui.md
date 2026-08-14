---
name: ui-context
description: Conventions UI, injected when the prompt mentions UI/UX
events: [before_agent_start]
match:
  input:
    contains: [ui, ux, "interface utilisateur", "user interface"]
action:
  type: inject
  once: true
---

# UI Conventions

- Use the existing components in `src/lib/components/` before writing new ones.
- Prefer Svelte 5 runes ($state, $derived) over legacy reactive statements.
- French UI strings, English code identifiers.
