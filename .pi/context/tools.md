---
name: tools-example
description: Exemple — active un outil custom quand on parle de messages de commit
events: [before_agent_start]
match:
  input: {contains: ["message de commit", "commit message"]}
action:
  type: tools
  enable: [commit_message_gen]
priority: high
---

Exemple pédagogique de l'action `tools` : active/désactive des outils pi selon
le contexte. Ici, l'outil hypothétique `commit_message_gen` (enregistré par une
autre extension) est activé quand le sujet s'y prête. Ne désactive aucun outil
par défaut — adapte à ton projet (ou `disable: [bash]` sur un projet sensible).
