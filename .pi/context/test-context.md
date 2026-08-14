---
name: test-context
description: Conventions de test, injectées après une commande de test
events: [tool_call]
match:
  tool: bash
  command:
    contains: ["pytest", "vitest", "go test"]
action:
  type: inject
  once: true
---

# Testing

- Run the focused test file (`pytest tests/x.py::test_name`), not the whole suite.
- Prefer `assert`-based checks over test doubles; add a test for every fix.
