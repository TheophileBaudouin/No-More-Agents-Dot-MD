---
name: <kebab-name>
description: <what and when>
events: [before_agent_start]
match:
  input: {contains: [<keyword>]}
action: {type: inject, once: true}
---

<context body>
