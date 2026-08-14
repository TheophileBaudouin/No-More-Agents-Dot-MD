---
name: <kebab-name>
description: <what and when — annotation ajoutée au résultat de l'outil>
events: [tool_result]
match:
  tool: bash
  command: {contains: ["<cmd>"]}
  result: {contains: ["<motif de sortie>"]}
action:
  type: annotate
  append: "<conseil ou contexte ajouté à la sortie>"
---
