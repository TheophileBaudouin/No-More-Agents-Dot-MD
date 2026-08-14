---
name: <kebab-name>
description: <what and when — visual feedback>
events: [tool_call]   # or any event
match:
  tool: bash
  command: {contains: ["<cmd>"]}
action:
  type: notify
  message: "<message to display>"
  level: warning      # info (default) | warning | error
---
