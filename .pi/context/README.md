# .pi/context

Chaque fichier `*.md` est une règle de comportement pour l'extension `context-engine` :

- Le **frontmatter YAML** décrit le comportement (`events`, `match`, `action`).
- Le **corps Markdown** est le contexte injecté à l'agent. Il n'est jamais montré autrement.
- Un fichier sans frontmatter (comme celui-ci) est de la documentation inerte.

Les règles sont chargées au `session_start` : redémarrez pi après une modification.

Référence complète : `~/.pi/agent/skills/context-engine/references/` (après installation du skill).
