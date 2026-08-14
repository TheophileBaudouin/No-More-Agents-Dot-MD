---
name: <kebab-name>
description: <what and when — enables/disables tools by context>
events: [before_agent_start]   # or tool_call, input
match:
  input: {contains: ["<topic>"]}
action:
  type: tools
  enable: [<tool>]      # tool to enable (registered in pi)
  disable: [<tool>]     # tool to disable (at least one of the two)
priority: high
---
