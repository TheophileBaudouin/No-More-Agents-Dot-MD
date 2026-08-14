---
name: <kebab-name>
description: <what and when — annule /new, /resume, /fork, /clone>
events: [session_before_switch]   # ou session_before_fork
match:
  input: {contains: ["<raison: new | resume | before | at>"]}   # optionnel
action:
  type: confirm
  message: "<question posée à l'utilisateur>"
priority: high
---

Variante : `type: block` pour annuler sans dialogue.
