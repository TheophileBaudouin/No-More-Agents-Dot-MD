# Events

A rule fires on the events listed in `events`. Each event exposes a different
"subject" that `match` runs against. All events also expose the session state
keys (`model`, `cwd`, `sessionSize`, `contextFill`).

| Événement | Se déclenche | Sujet de match | Actions autorisées |
|-----------|--------------|----------------|--------------------|
| `before_agent_start` | après la soumission d'un prompt, avant la boucle agent | text = le prompt ; model, cwd, sessionSize, contextFill | inject, tools, notify |
| `tool_call` | avant l'exécution d'un outil | tool = nom ; text = JSON des arguments ; command ; model, cwd, sessionSize, contextFill | block, confirm, modify, inject, tools, notify |
| `tool_result` | après l'exécution d'un outil | tool ; text = JSON des arguments ; command ; **result** = sortie texte ; model, cwd, sessionSize, contextFill | annotate, inject, notify |
| `input` | à la saisie utilisateur, avant expansion skills/templates | text = saisie brute ; **source** = interactive\|rpc\|extension ; model, cwd, sessionSize, contextFill | transform, handled, tools, notify |
| `user_bash` | commande `!` / `!!` tapée à la main | text = commande ; command ; model, cwd, sessionSize, contextFill | block, confirm, modify, notify |
| `session_before_switch` | avant `/new` ou `/resume` | text = reason (new\|resume) ; model, cwd, sessionSize, contextFill | confirm, block, notify |
| `session_before_fork` | avant `/fork` ou `/clone` | text = position (before\|at) ; model, cwd, sessionSize, contextFill | confirm, block, notify |

## Par événement

### before_agent_start

Fires after the user submits a prompt, before the agent loop.

- Subject text: the user's prompt (`event.prompt`).
- `inject` appends the body to the system prompt. `once: true` injects only on
  the first matching prompt of the session.
- `tools` / `notify` s'appliquent aussi ici.

### tool_call

Fires before a tool executes. Can block, confirm, modify, queue guidance,
toggle tools, or notify.

- Subject: tool name (`event.toolName`), the tool input JSON, and `command`
  (the string value of `input.command` for bash-like tools).
- `inject` here means: queue the body, delivered before the next LLM call via
  the `context` event — guidance the model sees right after the tool result.

### tool_result

Fires after a tool executed, before the result is finalized.

- Subject: tool name, the tool input JSON, `command`, and `result` (the
  concatenated text output of the tool).
- `annotate` patches the result (append text, merge details).
- `inject` queues the body for the next LLM call (same delivery as tool_call).

### input

Fires on raw user input, before skill/template expansion.

- `transform` replaces the input text (rules chain in priority order — each
  transform rule replaces the current text).
- `handled` consumes the input: the agent does not run (first handled rule wins).
- `tools` / `notify` s'appliquent aussi.

### user_bash

Fires on `!` / `!!` commands typed by the user.

- Same guard semantics as `tool_call`: `block` / `confirm` / `modify` apply to
  the manual command.

### session_before_switch / session_before_fork

Fires before `/new`, `/resume`, `/fork`, `/clone`.

- `block` / `confirm` refusé → `{cancel: true}` : l'action de session est
  annulée.
