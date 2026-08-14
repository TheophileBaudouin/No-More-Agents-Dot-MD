---
name: <kebab-name>
description: <what and when>
events: [tool_call]
match:
  tool: bash
  command: {contains: ["<cmd>"]}
action: {type: inject, once: true}
---

<context body — shown to the model right after the tool result>
