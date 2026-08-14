# Recherche : surface SDK pi → opportunités pour le Context Engine (v2)

Date : 2026-08-14 — Phase de recherche demandée avant tout développement v2.
Objectif : exploiter au maximum le SDK pi (aller aussi loin qu'on le veut,
ou rester simple si on choisit de l'être), sans s'arrêter aux exemples v1.

## 1. Méthode et sources

Tout lu intégralement (aucune extrapolation) :

| Source | Contenu | Taille |
|--------|---------|--------|
| `docs/extensions.md` (pi 0.84.1) | Doc officielle des extensions : événements, API, UI | 2988 lignes |
| `dist/core/extensions/types.d.ts` | Types SDK : événements, `ExtensionAPI`, `ExtensionContext` | 1294 lignes |
| `dist/core/system-prompt.d.ts` | `BuildSystemPromptOptions` (données système vues par l'agent) | — |
| `dist/core/messages.d.ts` | Types de messages (`CustomMessage`, rôles) | — |
| Extension actuelle (v1) | `frontmatter.ts`, `match.ts`, `engine.ts`, `index.ts` + tests | 4 fichiers |
| Skill + plan | `skill/context-engine/`, `docs/plans/2026-08-14-context-engine.md` | — |

## 2. Ce que l'extension couvre déjà (v1)

| Brique | État v1 |
|--------|---------|
| Événements écoutés | `session_start` (chargement), `before_agent_start` (inject), `tool_call` (garde), `context` (livraison) |
| Actions | `inject` (once/session), `confirm` (fail-safe sans UI), `block`, `modify` (append/prepend sur `input.command`) |
| Matching | `input` (texte du prompt ou JSON de l'appel outil), `command` (commande bash), `tool` (nom), `any` (OU) |
| Priorité | high / normal / low (tri descendant) |
| Chargement | Dossier `.pi/context/*.md`, frontmatter YAML-sous-ensemble, `README.md` ignoré, pas de watcher (reload à `session_start`) |

Limites v1 connues : pas de réaction au résultat d'un outil (`tool_result`), pas
d'interception de la saisie utilisateur (`input`), pas de contrôle des outils
actifs, pas de commande de gestion, aucune information de session dans `match`.

## 3. Inventaire complet du SDK pi

### 3.1 Les événements (ce que pi émet)

Tout ce que `pi.on(...)` permet d'écouter, et ce que chaque événement expose :

| Événement | Expose | Peut faire | Intérêt context-engine |
|-----------|--------|-----------|------------------------|
| `project_trust` | cwd | décider/annuler la confiance du projet | faible |
| `resources_discover` | cwd, reason | ajouter des chemins skill/prompt/thème | faible (le skill existe déjà) |
| `session_start` | reason, previousSessionFile | initialisation | déjà utilisé |
| `session_info_changed` | name | — | faible |
| `session_before_switch` | reason, targetSessionFile | **annuler** (/new, /resume) | **élevé** — garder les changements de session |
| `session_before_fork` | entryId, position | **annuler** (/fork, /clone) | **élevé** — garder les forks |
| `session_before_compact` | preparation, reason | annuler ou **personnaliser le résumé** | moyen — règles de compaction |
| `session_compact` | compactionEntry | — | faible |
| `session_before_tree` | preparation | annuler | faible |
| `session_tree` | newLeafId | — | faible |
| `session_shutdown` | reason | nettoyage | faible |
| `before_agent_start` | prompt, **systemPromptOptions** (fichiers de contexte, skills, outils chargés), images | injecter message / **modifier le system prompt** | déjà utilisé — les options ouvrent de nouvelles dimensions de match |
| `agent_start` / `agent_end` / `agent_settled` | messages (agent_end) | observer | moyen — guidance après la fin d'une passe |
| `turn_start` / `turn_end` | turnIndex, message, toolResults | observer | moyen — guidage par tour |
| `message_start` / `message_update` / `message_end` | message | **remplacer le message finalisé** (même rôle) | faible |
| `tool_execution_start` / `_update` / `_end` | toolName, args, result, isError | observer | faible |
| `context` | messages (copie) | **filtrer/ajouter des messages** avant l'appel LLM | déjà utilisé |
| `before_provider_headers` | headers | muter les en-têtes HTTP | faible |
| `before_provider_request` | payload | remplacer le payload | très faible |
| `after_provider_response` | status, headers | observer | faible (logs 429…) |
| `model_select` | model, previousModel, source | observer | moyen — notifications de changement de modèle |
| `thinking_level_select` | level, previousLevel | observer | moyen |
| `tool_call` | toolName, **input mutable** | **bloquer / confirmer / modifier / terminer** | déjà utilisé |
| `tool_result` | toolName, content, details, isError, usage | **modifier le résultat** (patch partiel) | **élevé** — réagir à la sortie d'un outil |
| `user_bash` | command, excludeFromContext | **intercepter** les commandes `!` / `!!` de l'utilisateur | **élevé** — garder aussi les commandes manuelles |
| `input` | text, images, source, streamingBehavior | **transformer / intercepter / gérer** la saisie avant expansion | **élevé** — règles sur la saisie brute |

### 3.2 L'API `pi.*` (ce que l'extension peut faire)

| Méthode | Effet | Intérêt context-engine |
|---------|-------|------------------------|
| `registerTool` | outil appelable par le LLM | **élevé** — outil « contexte » (voir §4.4) |
| `registerCommand` | commande `/x` | **élevé** — `/context` (liste/reload/état) |
| `registerShortcut` | raccourci clavier | faible |
| `registerFlag` | drapeau CLI | faible |
| `sendMessage` | message custom (participe au contexte LLM, affichable TUI) | moyen — annonces de règles |
| `sendUserMessage` | message utilisateur → **déclenche un tour** | **élevé** — relance automatique après un événement |
| `appendEntry` / `registerEntryRenderer` | persistance hors contexte LLM + rendu TUI | moyen — historique des règles |
| `setSessionName` / `setLabel` | nommer / marquer la session | faible |
| `exec` | exécuter une commande (git status…) | moyen — règles conditionnées à l'état du repo |
| `getActiveTools` / `getAllTools` / `setActiveTools` | **lire/remplacer les outils actifs** | **élevé** — activation contextuelle d'outils |
| `getCommands` | commandes disponibles | faible |
| `setModel` / `getThinkingLevel` / `setThinkingLevel` | **changer de modèle / niveau de réflexion** | **élevé** — adapter l'effort au sujet |
| `registerProvider` / `unregisterProvider` | providers | nul |
| `events` | bus inter-extensions | moyen |
| `setActiveTools` | cf. ci-dessus | cf. ci-dessus |

### 3.3 Le contexte `ctx.*` (ce qu'un handler voit)

`ctx.cwd`, `ctx.mode`, `ctx.hasUI`, `ctx.sessionManager` (entrées, branche,
feuille), `ctx.model`, `ctx.scopedModels`, `ctx.thinkingLevel`, `ctx.isIdle()`,
`ctx.getContextUsage()` (tokens / fenêtre / pourcentage), `ctx.compact()`,
`ctx.getSystemPrompt()`, `ctx.signal`, `ctx.abort()`, `ctx.shutdown()`.

**Intérêt fort** : `ctx.getContextUsage()` et `ctx.model` / `ctx.thinkingLevel`
sont des dimensions de match exploitables sans coût (déjà fournies par pi).

### 3.4 Données disponibles pour le matching (sans rien calculer soi-même)

- `event.prompt` (before_agent_start) — le prompt utilisateur
- `event.systemPromptOptions` : `contextFiles` (chemins + contenus chargés),
  `skills` (skills chargés), `selectedTools` (outils actifs), `customPrompt`,
  `appendSystemPrompt`, `promptGuidelines`, `cwd` — **la mine d'or** : on peut
  matcher sur les fichiers de contexte déjà chargés, les skills, les outils
- `event.toolName` + `event.input` (tool_call) — l'appel outil
- `event.input.command` (bash) — la commande
- `event.content` / `event.isError` / `event.details` (tool_result) — le résultat
- `event.text` (input) — la saisie brute
- `ctx.cwd` — le projet
- `ctx.model` — provider/modèle actif
- `ctx.thinkingLevel` — niveau de réflexion
- `ctx.getContextUsage()` — remplissage du contexte
- `ctx.sessionManager.getEntries().length` — taille de la session

## 4. Opportunités pour le Context Engine (classées par valeur)

### 4.1 Nouveaux événements de règle

1. **`input`** (valeur : très élevée — simple à implémenter)
   - Saisie brute avant expansion des skills/templates.
   - Nouvelle action `transform` : réécrire la saisie (ex : ajouter une
     consigne à tout prompt mentionnant un sujet). Action `handled` : répondre
     sans LLM (ex : « ping » → pong, ou notification).
2. **`tool_result`** (valeur : très élevée)
   - Réagit à la **sortie** d'un outil : annoter le résultat (ajouter des
     consignes après un échec de test, masquer/condenser une sortie bavarde).
   - Deux usages possibles : injecter du contexte (queue → `context` event,
     comme v1) et/ou **modifier le résultat** lui-même (nouvelle action
     `annotate` : `content` + `details`).
3. **`agent_end` / `agent_settled`** (valeur : moyenne)
   - Règle « quand la passe est finie, envoie une guidance » via
     `sendUserMessage({ deliverAs: "followUp" })`.
4. **`session_before_switch` / `session_before_fork`** (valeur : élevée —
   « bloquer certaines choses »)
   - Gardes de session : « confirmer avant /new si le repo est sale »,
     « bloquer /fork dans ce projet ». Actions `confirm`/`block` réutilisables
     telles quelles (le handler retourne `{cancel: true}`).
5. **`user_bash`** (valeur : élevée)
   - Appliquer les gardes `confirm`/`block`/`modify` aux commandes `!`/`!!`
     tapées à la main (le LLM n'est plus le seul à être surveillé).
6. **`session_before_compact`** (valeur : moyenne) — confirmer/annuler une
   compaction automatique selon une règle.

### 4.2 Nouvelles actions

1. **`tools`** (valeur : très élevée — le « très loin » du SDK)
   `action: {type: tools, enable: [...], disable: [...]}` — active/désactive
   des outils pi selon le contexte (ex : désactiver `bash` sur un projet
   sensible ; activer un outil custom quand le sujet s'y prête). Backed by
   `pi.getActiveTools()` / `pi.setActiveTools()`. Réversible par règle
   `once: false` au `session_start`.
2. **`notify` / `status`** (valeur : élevée — feedback utilisateur)
   `action: {type: notify, message: "..."}` → `ctx.ui.notify` quand une règle
   s'applique. Écrire des règles devient vérifiable visuellement.
3. **`thinking`** (valeur : moyenne)
   `action: {type: thinking, level: high}` → `pi.setThinkingLevel()`. Adapter
   l'effort au sujet (sécurité → high, correction rapide → low).
4. **`transform`** (pour `input`) — voir 4.1.1.
5. **`annotate`** (pour `tool_result`) — voir 4.1.2.
6. **`turn`** (valeur : moyenne) — `pi.sendUserMessage` pour relancer l'agent
   après un événement (ex : après un échec de test, demander au modèle de
   corriger automatiquement).

### 4.3 Nouvelles dimensions de match (schéma `match`)

Ajouts possibles sans rien calculer (les données viennent du SDK) :

| Clé | Donnée | Coût |
|-----|--------|------|
| `model` | `ctx.model.provider` / `.id` (string ou liste) | faible |
| `thinking` | `ctx.thinkingLevel` (string ou liste) | faible |
| `cwd` | `ctx.cwd` — matcher sur le chemin du projet (ex : nom du repo) | faible |
| `contextFill` | `ctx.getContextUsage().percent` — seuil (ex : `> 80`) | faible |
| `sessionSize` | nombre d'entrées de session (ex : `> 40`) | faible |
| `skills` | noms des skills chargés (`systemPromptOptions.skills`) | faible |
| `toolsActive` | noms des outils actifs (`selectedTools`) | faible |
| `contextFiles` | chemins des fichiers de contexte chargés (AGENTS.md…) | faible |
| `result` | pour `tool_result` : matcher sur le contenu de sortie (`content` texte + `isError`) | faible |
| `git` | état du repo (nécessite `exec` — **casse la pureté** du moteur) | moyen — à trancher |

Note architecture : le moteur pur (engine/match/frontmatter) n'importe pas pi.
Ajouter des dimensions de match « fournies par pi » se fait proprement en
étendant `Subject` : le handler construit un `Subject` plus riche, la pureté
du moteur est conservée. Seul `git` demanderait d'injecter une fonction
(`ctx.exec`-like) — à exclure de v1 ou à faire via un champ `Subject.git`
rempli par le handler.

### 4.4 Améliorations UX et gestion

1. **Commande `/context`** (valeur : élevée)
   - `pi.registerCommand("context", …)` : `/context` liste les règles (nom,
     événement, priorité, match), `/context reload` recharge le dossier sans
     redémarrer pi, `/context status` montre ce qui a été injecté/bloqué dans
     la session. Le chargement est déjà synchrone → reload trivial.
2. **Outil `context_rules` pour le LLM** (valeur : moyenne)
   - `pi.registerTool(...)` : le modèle peut consulter les règles actives
     (« que dois-je savoir ici ? »). Risque de bruit → en option.
3. **Autocomplétion** (valeur : faible) — `addAutocompleteProvider` pour taper
   `/context ...` plus vite. Décoratif.

## 5. Recommandation par valeur / effort

| Opportunité | Valeur | Effort | Verdict |
|-------------|--------|--------|---------|
| Événement `input` + action `transform` | très élevée | faible | à faire |
| Événement `tool_result` + action `annotate` | très élevée | faible-moyen | à faire |
| Événement `user_bash` (gardes sur `!`) | élevée | faible | à faire |
| Événement `session_before_switch`/`fork` (gardes de session) | élevée | faible | à faire |
| Action `tools` (enable/disable) | très élevée | moyen | à trancher (Q2) |
| Action `notify` | élevée | très faible | à faire |
| Commande `/context` (liste/reload/état) | élevée | faible | à faire |
| Dimensions `model`/`thinking`/`cwd`/`contextFill`/`sessionSize` | moyenne-élevée | faible | à trancher (Q3) |
| Dimensions `skills`/`toolsActive`/`contextFiles` | moyenne | faible | à trancher (Q3) |
| Événement `agent_end` + relance `sendUserMessage` | moyenne | moyen | optionnel |
| Action `thinking` (niveau de réflexion) | moyenne | faible | optionnel |
| `session_before_compact` | moyenne | faible | optionnel |
| Outil `context_rules` pour le LLM | moyenne | moyen | optionnel |
| Dimension `git` (état repo) | moyenne | moyen | à exclure (casse la pureté) |
| Autocomplétion `/context` | faible | faible | décoratif |

## 6. Décisions actées (réponses utilisateur, 2026-08-14)

1. **Portée** — « Tout le menu fort » : événements `input` (+ `transform`/`handled`),
   `tool_result` (+ `annotate`), `user_bash` (gardes sur `!`), gardes de session
   (`session_before_switch`, `session_before_fork`), action `notify`, commande de
   gestion. Hors périmètre v2 : `agent_end`/relance automatique, `thinking`,
   `session_before_compact`, outil `context_rules`, dimension `git`, autocomplétion.
2. **Action `tools`** — oui : `action: {type: tools, enable: [...], disable: [...]}`
   via `pi.getActiveTools()` / `pi.setActiveTools()`.
3. **Matching** — ajouter `model` (modèle actif), `cwd` (chemin du projet),
   `sessionSize` (taille de la session), `contextFill` (remplissage du contexte).
   Pas de `skills`/`toolsActive`/`contextFiles` en v2.
4. **Feedback** — commande nommée **`/nma`** (pas `/context`) : liste les règles,
   recharge sans redémarrer pi, montre l'état de la session. + notification
   (`ctx.ui.notify`) quand une règle injecte ou bloque.

### Contraintes héritées du projet

- Le moteur pur (engine/match/frontmatter) n'importe pas pi → les nouvelles
  dimensions arrivent par un `Subject` enrichi construit par le handler.
- Tout paramètre ajouté entraîne l'adaptation du skill (schéma, événements,
  actions, matching, templates) — exigence du projet.
- Zéro dépendance npm ; tests `node --test` + type-stripping Node.
