# Brief — no-agents dot md

## Mission

« no-agents dot md » : une couche déclarative (extension pi + skill) qui remplace
le monolithique `AGENTS.md` par des micro-contextes `.pi/context/*.md`. Le YAML
décrit le comportement (événement, match, action) ; le corps Markdown est le
contexte injecté. Objectif : exploiter au maximum le SDK pi — aller aussi loin
qu'on le veut dans la gestion du contexte, le blocage et l'ajout de comportements,
ou rester simple.

## Stack

- Extension TypeScript : `.pi/extensions/context-engine/` (frontmatter.ts,
  match.ts, engine.ts, index.ts + tests `*.test.ts`).
- **Zéro dépendance npm runtime** : parser YAML-sous-ensemble maison, tests
  `node --test` + type-stripping Node (v23.11.0 vérifié). `@types/node` et
  `@earendil-works/pi-coding-agent` sont des devDeps types-only.
- Skill : `skill/context-engine/` (SKILL.md + references/ + templates/).
- Plan : `docs/plans/` ; recherche : `docs/research/`.
- Vérification : `cd .pi/extensions/context-engine && node --test "*.test.ts"`,
  `tsc --noEmit` (racine), E2E `pi --print`.

## Conventions

- Pas d'`AGENTS.md` dans ce repo — c'est le propos du projet.
- YAML = comportement ; Markdown = contexte. Le frontmatter n'est jamais injecté.
- Un fichier sans frontmatter est une doc inerte.
- `confirm` sans UI = fail-safe block.
- Fichier plan = source de vérité ; toute correction doit y être synchronisée.
- Le moteur pur (engine/match/frontmatter) n'importe pas pi — les données pi
  arrivent par un `Subject` enrichi construit par le handler (index.ts).
- Repo path avec espaces : `"/Users/theophilebaudouin/Documents/devellopement/no-agents dot md"` — quoter tous les chemins.

## Architecture

- `frontmatter.ts` : parseYamlSubset (clés/valeurs, listes `[...]`, maps `{...}`,
  blocs indentés 2 espaces, splitTopLevel pour les virgules dans les crochets).
- `match.ts` : matchRule(MatchSpec, Subject) — dimensions v2 : input, command,
  tool, any, model, cwd, sessionSize, contextFill, result (sortie outil), source.
- `engine.ts` : Rule (name, description, events, match, action, priority, body,
  file), parseContextFile, sortRules (high=3, normal=2, low=1), loadContextDir
  (non-récursif, README.md ignoré), selectInject, selectToolRules, selectForEvent.
- `index.ts` : wiring pi — session_start (reload), before_agent_start (inject),
  tool_call (block/confirm/modify/inject/tools/notify), context (livraison queue),
  tool_result (annotate/inject/notify), input (transform/handled/notify),
  user_bash (block/confirm/modify/notify), session_before_switch/fork (confirm/
  block → cancel), commande `/nma` (liste/reload/état).
