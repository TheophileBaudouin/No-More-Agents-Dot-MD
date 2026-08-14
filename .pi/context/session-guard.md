---
name: fork-guard
description: Confirme avant de forker la session
events: [session_before_fork]
action:
  type: confirm
  message: "Forker la session ? La branche abandonnée sera résumée."
priority: high
---
