# Progress — no-agents dot md

## v1 — livrée (11 commits, tout vert)

- Extension `.pi/extensions/context-engine/` : frontmatter/match/engine/index + 4
  fichiers de tests (30/30 `node --test`).
- Exemples `.pi/context/` : ui.md, git-safety.md, test-context.md, README.md.
- Skill `skill/context-engine/` : SKILL.md + 6 references + 6 templates.
- E2E réel vérifié : injection `before_agent_start` (conventions UI) + garde
  `git push` bloquée sans UI.
- Diagnostiques pi-lens nettoyés (96 → 1 advisory volontaire) : tsconfig racine +
  extension (lib es2023, allowImportingTsExtensions, types node), devDeps types,
  upgrade du typescript bundlé pi-lens 4.9.5 → 5.9.3, bug réel `context` handler
  (AgentMessage sans rôle "system" → message `user` + timestamp).

## v2 — décidé (2026-08-14, réponses utilisateur)

Portée « tout le menu fort » :

1. Événements : `input` (+transform/handled), `tool_result` (+annotate),
   `user_bash` (gardes), `session_before_switch`/`session_before_fork` (gardes).
2. Action `tools` (enable/disable via pi.setActiveTools).
3. Action `notify` + notification quand une règle injecte ou bloque.
4. Matching : `model`, `cwd`, `sessionSize`, `contextFill` (+ `result` pour
   tool_result, `source` pour input — nécessaires au fonctionnement).
5. Commande **`/nma`** (liste / reload sans redémarrage / état de session).
Hors périmètre v2 : agent_end/relance, thinking, session_before_compact, outil
context_rules, dimension git, autocomplétion.

## À faire (ordre)

- [ ] Plan v2 écrit → docs/plans/2026-08-15-context-engine-v2.md
- [ ] Tâche 1 : match.ts v2 (nouvelles dimensions) + tests
- [ ] Tâche 2 : engine.ts v2 (actions, sélection par événement) + tests
- [ ] Tâche 3 : index.ts v2 (nouveaux handlers, dispatch actions, journal) + fake-pi tests
- [ ] Tâche 4 : commande /nma + reload + status
- [ ] Tâche 5 : skill v2 (schema/events/actions/matching/tool-hooks/examples + templates)
- [ ] Tâche 6 : exemples v2 + README + E2E réel + commit
- [ ] Sync plan doc si les tests TDD révèlent des corrections (comme v1)

## Prochaines étapes (hors v2)

- Watcher de fichiers (reload auto), outil context_rules pour le LLM,
  dimension git (nécessite exec — casse la pureté, à trancher), autocomplétion.
