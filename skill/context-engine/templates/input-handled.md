---
name: <kebab-name>
description: <what and when — the input is consumed, the agent does not run>
events: [input]
match:
  input: {contains: ["<trigger>"]}
action: {type: handled}
---

Optional: add a `notify` rule (same event) for visible feedback, e.g.
action: {type: notify, message: "pong"}.
