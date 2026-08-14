---
name: git-safety
description: Confirme avant les commandes git destructives
events: [tool_call]
match:
  tool: bash
  command:
    regex: ["^git push", "^git reset --hard", "^git push --force"]
action:
  type: confirm
  message: "Commande Git potentiellement destructive."
priority: high
---
