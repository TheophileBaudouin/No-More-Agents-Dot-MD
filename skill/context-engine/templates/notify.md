---
name: <kebab-name>
description: <what and when — feedback visuel>
events: [tool_call]   # ou n'importe quel événement
match:
  tool: bash
  command: {contains: ["<cmd>"]}
action:
  type: notify
  message: "<message affiché>"
  level: warning      # info (défaut) | warning | error
---
