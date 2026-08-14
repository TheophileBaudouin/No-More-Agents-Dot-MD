# Tool hooks in depth

## tool_call

`tool_call` rules run in priority order (high → low). The first `block` return
wins and stops the loop; `confirm` approvals, `modify` patches, `inject`
queues, `tools` toggles and `notify` calls all accumulate before the tool
executes.

Execution guarantees (pi SDK):

- `event.input` is mutable; patches affect the real execution. No re-validation
  happens after mutation.
- `{ block: true, reason }` cancels the tool.
- The `context` event fires before the next LLM call; queued `inject` bodies are
  appended there as a `user` message (drained once — one delivery per tool
  call; `AgentMessage` has no `system` role, so user is the injection shape).

Typical guard shape:

```yaml
---
name: dangerous-git
events: [tool_call]
match:
  tool: bash
  command: {regex: ["^git reset --hard"]}
action:
  type: confirm
  message: "Destructive git command."
priority: high
---
```

## tool_result

Fires after the tool executed, before the result is finalized. Rules can:

- `annotate` : patch le résultat — `append` ajoute un bloc texte à la sortie,
  `details` est fusionné dans les details. Le modèle voit le texte annoté.
- `inject` : queue le body pour le prochain appel LLM (comme tool_call).
- `notify` : feedback visuel.

Matching sur la sortie via `result` :

```yaml
---
name: test-failure-guidance
events: [tool_result]
match:
  tool: bash
  command: {contains: ["pytest"]}
  result: {contains: ["FAILED"]}
action:
  type: annotate
  append: |
    Conseil : lancez le test isolé avant de corriger.
---
```

## user_bash (commandes `!` / `!!`)

Les gardes s'appliquent aussi aux commandes tapées à la main.

- `block` → la commande est remplacée par un résultat d'erreur : sortie =
  message de la règle, `exitCode: 1`.
- `confirm` → dialogue ; refusé = bloquée. Sans UI, bloquée fail-safe.
- `modify` → la commande est enveloppée avec `prepend` / `append` (via
  `createLocalBashOperations`).

## Gardes de session (`/new`, `/resume`, `/fork`, `/clone`)

`session_before_switch` (reason : new|resume) et `session_before_fork`
(position : before|at) permettent d'annuler un changement de session :

```yaml
---
name: session-guard
events: [session_before_fork]
action:
  type: confirm
  message: "Forker cette session ?"
priority: high
---
```

- `block` → `{cancel: true}`.
- `confirm` refusé → `{cancel: true}`. Sans UI → `{cancel: true}` (fail-safe).

## Commande `/nma`

`/nma` gère les règles depuis pi, sans redémarrer :

- `/nma` — liste les règles (nom, événements, action, priorité, fichier, match).
- `/nma reload` — recharge `.pi/context/` immédiatement.
- `/nma status` — état de la session : règles chargées, injections `once`,
  contexte en attente, journal des actions (les 10 dernières).

## Notifications

Quand une règle injecte ou bloque (ou qu'un confirm est refusé), une
notification `[nma] ...` est affichée si pi a une UI. L'action `notify`
permet un message personnalisé (`level: info | warning | error`).
