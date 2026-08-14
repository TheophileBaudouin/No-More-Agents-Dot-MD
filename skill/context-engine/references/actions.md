# Actions

| Action | Événements | Effet |
|--------|-----------|-------|
| `inject` | before_agent_start, tool_call, tool_result | Body ajouté au system prompt (agent start) ou mis en file pour le prochain appel LLM (tool_call, tool_result). |
| `confirm` | tool_call, user_bash, session_before_switch, session_before_fork | `ctx.ui.confirm(name, message)`. Refusé → outil bloqué / session annulée. Sans UI, bloque fail-safe. |
| `block` | tool_call, user_bash, session_before_switch, session_before_fork | Outil bloqué (ou session annulée) avec `message` (ou nom) comme raison. |
| `modify` | tool_call, user_bash | Patche la commande : `command: {append: "...", prepend: "..."}`. |
| `tools` | before_agent_start, tool_call, input | Active/désactive des outils pi : `enable: [...]`, `disable: [...]` (au moins un). |
| `notify` | tous | `ctx.ui.notify(message, level)` — feedback visuel. |
| `transform` | input | Remplace le texte de la saisie par `text`. |
| `handled` | input | Consomme la saisie : l'agent ne tourne pas. |
| `annotate` | tool_result | Patche le résultat de l'outil : `append` (texte ajouté), `details` (fusionné). |

## Options par action

- `inject` : `once: true` — une seule injection par session (suivi par nom de
  règle). Sans `once`, `before_agent_start` injecte à chaque prompt qui matche.
- `confirm` / `block` : `message` optionnel (raison affichée / raison de blocage).
- `modify` : `command: {append?, prepend?}`.
- `tools` : `enable` (liste de noms d'outils) et/ou `disable` (liste) — le nom
  d'outil doit être enregistré dans pi.
- `notify` : `message`, `level: info | warning | error` (défaut `info`).
- `transform` : `text` (obligatoire — nouveau texte de la saisie).
- `handled` : aucune option.
- `annotate` : `append` (texte ajouté à la sortie), `details` (objet fusionné
  dans les details du résultat).

## Notifications automatiques

En plus de l'action `notify`, quand une règle **injecte** ou **bloque** (ou
qu'un confirm est refusé), l'extension affiche une notification `[nma] ...` si
pi a une UI (`ctx.hasUI`). En mode sans UI, rien n'est affiché — et `confirm`
bloque fail-safe.

## Matrice événement × action

| | inject | confirm | block | modify | tools | notify | transform | handled | annotate |
|---|---|---|---|---|---|---|---|---|---|
| before_agent_start | ✓ | | | | ✓ | ✓ | | | |
| tool_call | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | |
| tool_result | ✓ | | | | | ✓ | | | ✓ |
| input | | | | | ✓ | ✓ | ✓ | ✓ | |
| user_bash | | ✓ | ✓ | ✓ | | ✓ | | | |
| session_before_switch | | ✓ | ✓ | | | ✓ | | | |
| session_before_fork | | ✓ | ✓ | | | ✓ | | | |

`confirm` / `block` need no Markdown body.

Security note: `confirm` is fail-safe. If pi has no UI (`ctx.hasUI === false`),
a confirm rule blocks rather than silently allowing.
