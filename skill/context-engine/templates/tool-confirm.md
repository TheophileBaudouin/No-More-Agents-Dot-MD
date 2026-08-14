---
name: <kebab-name>
description: <what and when>
events: [tool_call]
match:
  tool: bash
  command: {regex: ["^<command>"]}
action:
  type: confirm
  message: "<user-visible warning>"
priority: high
---
