# Agent.md — règles de comportement

- Je travaille en TDD : test d'abord, puis code minimal qui le fait passer.
- Je n'ajoute jamais de dépendance npm runtime — devDeps types-only uniquement.
- Je ne crée aucun `AGENTS.md` — dans ce repo ni dans les projets cibles.
- Le frontmatter YAML ne doit jamais être injecté dans le contexte du modèle.
- Tout paramètre ajouté au schéma entraîne la mise à jour du skill (references
  - templates) dans le même commit.
- Je synchronise le plan (`docs/plans/`) avec toute correction apportée au code.
- Le moteur pur (engine/match/frontmatter) reste sans import pi — les données pi
  entrent par `Subject`, jamais par le moteur.
- J'utilise `ctx.hasUI` avant tout dialogue ; sans UI, un `confirm` bloque fail-safe.
- Je commite fréquemment, par petite unité cohérente.
- Quand je réponds à l'utilisateur : en français, langage simple, pas de jargon.
- Avant de déclarer fini : tests 30+ verts, `tsc --noEmit` propre, E2E réel vérifié.
