---
name: <kebab-name>
description: <what and when>
events: [tool_call]
match:
  tool: bash
  command: {regex: ["<pattern>"]}
action:
  type: block
  message: "<reason>"
---
