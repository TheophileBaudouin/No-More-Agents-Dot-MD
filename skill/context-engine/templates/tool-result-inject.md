---
name: <kebab-name>
description: <what and when — guidance après un résultat d'outil>
events: [tool_result]
match:
  tool: bash
  command: {contains: ["<cmd>"]}
action: {type: inject, once: true}
---

<contexte montré au modèle juste après le résultat de l'outil>
