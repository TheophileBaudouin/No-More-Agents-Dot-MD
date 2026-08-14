---
name: <kebab-name>
description: <what and when — active/désactive des outils selon le contexte>
events: [before_agent_start]   # ou tool_call, input
match:
  input: {contains: ["<sujet>"]}
action:
  type: tools
  enable: [<tool>]      # outil à activer (enregistré dans pi)
  disable: [<tool>]     # outil à désactiver (au moins un des deux)
priority: high
---
