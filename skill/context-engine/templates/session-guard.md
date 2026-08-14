---
name: <kebab-name>
description: <what and when — cancels /new, /resume, /fork, /clone>
events: [session_before_switch]   # or session_before_fork
match:
  input: {contains: ["<reason: new | resume | before | at>"]}   # optional
action:
  type: confirm
  message: "<question asked to the user>"
priority: high
---

Variant: `type: block` to cancel without a dialog.
