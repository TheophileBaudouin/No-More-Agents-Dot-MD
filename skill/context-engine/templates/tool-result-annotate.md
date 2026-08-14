---
name: <kebab-name>
description: <what and when — annotation added to the tool result>
events: [tool_result]
match:
  tool: bash
  command: {contains: ["<cmd>"]}
  result: {contains: ["<output pattern>"]}
action:
  type: annotate
  append: "<tip or context added to the output>"
---
