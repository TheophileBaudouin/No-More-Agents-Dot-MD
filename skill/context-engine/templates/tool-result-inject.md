---
name: <kebab-name>
description: <what and when — guidance after a tool result>
events: [tool_result]
match:
  tool: bash
  command: {contains: ["<cmd>"]}
action: {type: inject, once: true}
---

<context shown to the model right after the tool result>
