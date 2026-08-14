---
name: context-engine
description: Creates .pi/context/*.md declarative behavior rules for the Pi context-engine extension — conditional context injection, tool guards, confirmations, user-input transforms, post-tool guidance, session-change guards, tool toggling and notifications, managed via the /nma command. Use when asked to add project conventions (UI, git, testing, security), guardrails, or conditional context to a Pi project.
---

# Context Engine

The `context-engine` Pi extension turns `.pi/context/*.md` files into behaviors:
the YAML frontmatter describes WHEN a rule applies and WHAT it does; the Markdown
body is the context injected into the agent. The frontmatter is never shown to
the model — only the body is.

Capabilities (v2):

- **inject** — contexte conditionnel dans le system prompt (au prompt) ou en
  file pour le prochain appel LLM (après un outil).
- **block / confirm** — gardes sur les outils, sur les commandes `!` tapées à
  la main, et sur les changements de session (`/new`, `/resume`, `/fork`).
- **modify** — patch de commande (prepend/append).
- **tools** — activer/désactiver des outils selon le contexte.
- **transform / handled** — réécrire ou consommer une saisie utilisateur.
- **annotate** — réagir à la sortie d'un outil (résultat de test, etc.).
- **notify** — feedback visuel + notifications automatiques quand une règle
  injecte ou bloque.
- **`/nma`** — lister, recharger (sans redémarrer pi) et inspecter l'état des
  règles.

## Workflow

1. Pick the template in `templates/` closest to the requested behavior.
2. Copy it to `.pi/context/<name>.md` and fill in the frontmatter + body.
3. Tell the user to run `/nma reload` (ou redémarrer pi) pour recharger.

## Rules of thumb

- YAML describes behavior; Markdown is the context. Never put logic in the body.
- A file without frontmatter is inert documentation.
- Guard rules (`confirm`, `block`) need no Markdown body.
- `confirm` sans UI bloque fail-safe ; `notify` n'affiche rien sans UI.
- Consult `references/` only when a template doesn't fit: `schema.md` (full
  reference), `matching.md` (how `match` works), `actions.md` (what actions do),
  `events.md` (which events exist and what they match against), `tool-hooks.md`
  (tool/session hooks in depth), `examples.md` (ready-made rules).
