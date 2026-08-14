# Progress — no-agents dot md

## v2 — IMPLÉMENTÉ ET VÉRIFIÉ (2026-08-14)

Plan : `docs/plans/2026-08-15-context-engine-v2.md` (STATUT : implémenté).

### Ce qui a été livré

- **match.ts v2** : dimensions `model` (contains casse-insensible sur provider/id),
  `cwd` (formes input), `sessionSize`/`contextFill` (nombre = minimum >=, ou
  {min,max}), `result` (sortie outil, tool_result), `source` (égalité exacte, input).
- **engine.ts v2** : 9 actions (inject, confirm, block, modify, tools, notify,
  transform, handled, annotate), `VALID_EVENTS` (7), table événement→actions,
  validation au parse (événement inconnu / action incompatible → throw), `selectForEvent`.
- **index.ts v2** : `baseSubject` (model/cwd/sessionSize/contextFill), journal
  d'activité (100 max), `notifyRule`/`notifyInject`/`notifyBlock` (hasUI gardé),
  `applyTools` (getActiveTools/setActiveTools), handlers `input` (transform
  chaîné/handled), `tool_result` (annotate/inject), `user_bash` (block/confirm/
  modify via createLocalBashOperations), gardes session (`session_before_switch`,
  `session_before_fork` → cancel), `before_agent_start`/`tool_call` étendus
  (tools/notify + notifications auto), `context` inchangé.
- **Commande `/nma`** : liste (editor), `reload` (relecture du dossier sans
  redémarrage), `status` (journal + compteurs).
- **Skill v2** : 6 references à jour, 14 templates (+8 : input-transform,
  input-handled, tool-result-annotate, tool-result-inject, user-bash-guard,
  session-guard, tools-toggle, notify), SKILL.md à jour.
- **Exemples v2** : input.md (transform !review), tool-result.md (annotate échec
  test), tools.md (exemple enable, prudent), session-guard.md (confirm /fork),
  notify.md (warning git push). README v2.
- **Tests** : 63/63 (`node --test "*.test.ts"`), tsc --noEmit propre.

### E2E réel vérifié

- `pi --print "improve the ui"` → `8 rule(s) loaded`, injection des conventions UI
  confirmée par le modèle (« chaînes en français, identifiants en anglais »).
- `git push origin main` forcé → bloqué (« Commande Git potentiellement destructive »).
- Aucune erreur de parse au chargement des 8 règles.

### Exécution

Subagents `worker` (deepseek-v4-flash), un écrivain à la fois, gate `node --test`
sur chaque tâche : SA1 `0259ca9`, SA2 `16edd79`, SA3 `979b7fc` (relancé une fois —
apostrophe cassant le workflowScript), SA4 `7a20506`, SA5 `326d268`.
Dérogation : SA5 a enrichi `.pi/context/ui.md` (corps en français complet,
frontmatter inchangé) — gardé.

### Hors périmètre v2 (roadmap)

agent_end/relance, action thinking, session_before_compact, outil context_rules,
dimension git (casse la pureté), autocomplétion /nma, watcher de fichiers.

## Vérification avant déclaration de fini

- [x] 63/63 tests, tsc propre (racine + extension)
- [x] E2E réel (chargement, injection, garde, /nma couvert par fake-pi)
- [x] Skill synchronisé avec le schéma v2
- [x] Plan doc synchronisé (STATUT)
- [x] Mémoire projet à jour
