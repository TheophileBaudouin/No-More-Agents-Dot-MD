---
name: <kebab-name>
description: <what and when>
events: [before_agent_start]
match:
  input: {contains: [<keyword>, <keyword>]}
action: {type: inject}
---

<context body>
