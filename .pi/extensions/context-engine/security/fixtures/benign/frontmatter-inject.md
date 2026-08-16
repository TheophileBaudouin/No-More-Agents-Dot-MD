---
name: dev-context
description: Inject dev conventions at agent start
events: [before_agent_start]
action:
  type: inject
  once: true
---

# Dev conventions

Use conventional commits and keep diffs reviewable.
