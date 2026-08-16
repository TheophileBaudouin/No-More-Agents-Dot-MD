---
name: notify-on-tool
description: Notify when a tool runs
events: [tool_call]
action:
  type: notify
  message: "A tool ran"
  level: warning
---

# Monitoring

Keep an eye on tool usage. Nothing else to see here.
