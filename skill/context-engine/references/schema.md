# Frontmatter schema

Every rule file starts with a `---`-delimited YAML block. Unknown keys are
ignored (tolerated), so older examples keep working.

| Key | Required | Type | Meaning |
|-----|----------|------|---------|
| `name` | yes | string | Unique rule id. Used as section header in injected context and in block reasons. |
| `description` | no | string | Shown to the user / used as block reason fallback. |
| `events` | yes | string[] | One or more of the 7 valid events (see events.md). |
| `match` | no | map | When the rule applies. Absent = always. See matching.md. |
| `action` | yes | map | What happens when it applies. See actions.md. |
| `priority` | no | `high` \| `normal` \| `low` | `high`=3, `normal`=2, `low`=1. Rules run priority-desc. Default `normal`. |

## Events (7)

`before_agent_start` · `tool_call` · `tool_result` · `input` · `user_bash` ·
`session_before_switch` · `session_before_fork`

Every event in `events` must be one of these, and the action must be allowed
for that event — the loader rejects the file otherwise.

## Actions (9)

`inject` · `confirm` · `block` · `modify` · `tools` · `notify` · `transform` ·
`handled` · `annotate`

```yaml
action: {type: inject, once: true}                    # inject (once par session, défaut false)
action: {type: confirm, message: "..."}               # confirm / block (message optionnel)
action: {type: block, message: "..."}
action: {type: modify, command: {append: "...", prepend: "..."}}
action: {type: tools, enable: [x], disable: [y]}      # au moins un des deux
action: {type: notify, message: "...", level: warning}  # level: info|warning|error (défaut info)
action: {type: transform, text: "nouveau texte"}      # input seulement
action: {type: handled}                               # input seulement
action: {type: annotate, append: "...", details: {...}}  # tool_result seulement
```

Attention : la clé `level` (et non `type`) pour la variante de notify — `type`
est déjà le discriminant de l'action.

## Validation au chargement

- `events` : non vide, chaque événement doit être connu (erreur sinon, avec la
  liste des valides).
- `action.type` : connu **et compatible avec chaque événement listé** (erreur
  sinon, avec les actions autorisées pour cet événement).
- Un fichier sans frontmatter est une doc inerte (ignoré).

Example:

```yaml
---
name: ui-context
description: Conventions UI
events: [before_agent_start]
match:
  input: {contains: [ui, ux]}
action:
  type: inject
  once: true
priority: normal
---
```

The Markdown body after the closing `---` is the injected context. For guard
rules (`confirm`, `block`) the body is unused and may be empty.
