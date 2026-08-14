---
name: git-notify
description: Notifie quand une commande git push est tentée
events: [tool_call]
match:
  tool: bash
  command:
    regex: ["^git push"]
action:
  type: notify
  message: "git push détecté — la règle git-safety va demander confirmation."
  level: warning
---
