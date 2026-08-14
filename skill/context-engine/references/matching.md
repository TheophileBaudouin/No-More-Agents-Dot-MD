# Matching

`match` is optional; absent = the rule always applies. All text comparisons are
case-insensitive substrings unless a `regex` is given.

| Key | S'applique à | Forme |
|-----|-------------|-------|
| `input` | texte du prompt (before_agent_start), JSON des arguments (tool_call, tool_result) | string \| string[] \| `{contains: [...]}` \| `{regex: [...]}` \| liste de ces formes |
| `command` | `input.command` (outils bash-like, user_bash) | mêmes formes que `input` |
| `tool` | nom de l'outil (tool_call, tool_result) | string \| string[] |
| `result` | sortie texte de l'outil (tool_result) | mêmes formes que `input` |
| `model` | modèle actif `provider/id` (tous événements) | string \| string[] — contains insensible à la casse |
| `cwd` | chemin du projet (tous événements) | mêmes formes que `input` |
| `sessionSize` | nombre d'entrées de session (tous événements) | nombre = minimum (>=) ; ou `{min: n, max: n}` |
| `contextFill` | remplissage du contexte en % (tous événements) | nombre = minimum (>=) ; ou `{min, max}` |
| `source` | origine de la saisie (input) | string \| string[] — égalité exacte : interactive \| rpc \| extension |
| `any` | toute la règle | liste de sous-specs ; si UNE matche, la règle matche immédiatement |

Sémantique :

- Clés combinées = ET (toutes doivent matcher). `any` = OU gagnant immédiatement.
- Dans un objet de motifs, `contains` et `regex` sont OU ; chaque liste est
  any-of. `{contains: [ui, ux]}` matche "ui" ou "ux".
- `regex` est ancré tel qu'écrit : utilisez `^` pour les débuts de commande
  (`"^git push"`), et méfiez-vous des variantes `--force` (`"^git push --force"`).
- `sessionSize` / `contextFill` : un nombre seul signifie « au moins ce
  seuil » ; `{min: 5, max: 200}` borne inclusivement. Si la donnée n'est pas
  disponible (ex. percent inconnu), la clé ne matche pas.
- `model` : matche par sous-chaîne sur `provider/id` — `anthropic` matche
  `anthropic/claude-sonnet-4`, `claude-sonnet-4` matche aussi.

Exemple — garde bash :

```yaml
match:
  tool: bash
  command:
    regex: ["^git push", "^git reset --hard"]
```

Exemple — OR hétérogène :

```yaml
match:
  any:
    - input: {contains: ["test"]}
    - tool: bash
```

Exemple — réaction à la sortie d'un outil :

```yaml
match:
  tool: bash
  command: {contains: ["pytest"]}
  result: {contains: ["FAILED"]}
```

Exemple — seulement sur un projet et quand le contexte est chargé :

```yaml
match:
  cwd: {contains: ["mon-projet"]}
  contextFill: 80
```
