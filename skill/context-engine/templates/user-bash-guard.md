---
name: <kebab-name>
description: <what and when — guard on ! / !! commands typed by hand>
events: [user_bash]
match:
  command: {regex: ["^<pattern>"]}
action:
  type: confirm
  message: "<visible warning>"
priority: high
---

Variants: `type: block` to block without a dialog; `type: modify` with
`command: {prepend: "...", append: "..."}` to wrap the command.
