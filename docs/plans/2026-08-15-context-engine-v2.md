# Plan v2 — Context Engine étendu (input, tool_result, user_bash, gardes de session, tools, notify, /nma)

Date : 2026-08-15 — Base : v1 livrée (30/30 tests, E2E vérifié). Décisions utilisateur
verrouillées dans `docs/research/2026-08-14-sdk-surface-v2.md` §6.

**STATUT : IMPLÉMENTÉ ET VÉRIFIÉ (2026-08-14).** 63/63 tests, tsc propre, E2E réel
ok (8 règles chargées, injection avant_agent_start confirmée par le modèle, garde
`git push` bloquée). Exécuté par subagents `worker` (deepseek-v4-flash), commits
`0259ca9` (match), `16edd79` (engine), `979b7fc` (index + /nma), `7a20506` (skill),
`326d268` (exemples + README). Dérogation notée : `ui.md` enrichi par SA5 (conventions
complètes en français, frontmatter inchangé).

## Portée v2 (décidée)

| Brique | Détail |
|--------|--------|
| Événements | + `input`, `tool_result`, `user_bash`, `session_before_switch`, `session_before_fork` (7 au total) |
| Actions | + `tools`, `notify`, `transform`, `handled`, `annotate` (9 au total) |
| Matching | + `model`, `cwd`, `sessionSize`, `contextFill`, `result` (sortie outil), `source` (saisie) |
| Commande | `/nma` : liste / reload (sans redémarrage) / état de session |
| Feedback | notification `ctx.ui.notify` quand une règle injecte ou bloque |
| Skill | adaptation complète : schema, events, actions, matching, tool-hooks, exemples + 7 nouveaux templates |

Hors périmètre (explicitement écartés) : `agent_end`/relance automatique, action
`thinking`, `session_before_compact`, outil `context_rules` pour le LLM,
dimension `git`, autocomplétion.

## Schéma v2 (contrat)

### Événements et actions autorisées

| Événement | Sujet de match | Actions autorisées |
|-----------|----------------|--------------------|
| `before_agent_start` | text=prompt, model, cwd, sessionSize, contextFill | inject, tools, notify |
| `tool_call` | tool, text=input JSON, command, model, cwd, sessionSize, contextFill | block, confirm, modify, inject, tools, notify |
| `tool_result` | tool, text=input JSON, command, **result**=sortie texte, model, cwd, sessionSize, contextFill | annotate, inject, notify |
| `input` | text, **source**, model, cwd, sessionSize, contextFill | transform, handled, tools, notify |
| `user_bash` | text=commande, command, model, cwd, sessionSize, contextFill | block, confirm, modify, notify |
| `session_before_switch` | text=reason, model, cwd, sessionSize, contextFill | confirm, block, notify |
| `session_before_fork` | text=position, model, cwd, sessionSize, contextFill | confirm, block, notify |

### Formes d'action

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

### Dimensions de match (v2)

```yaml
match:
  model: anthropic            # string | string[] — contains insensible casse sur "provider/id"
  cwd: myproj                 # mêmes formes que input ({contains, regex}) — chemin absolu
  sessionSize: 40             # nombre = minimum (>=) ; ou {min: 5, max: 200}
  contextFill: 80             # nombre = % minimum (>=) ; ou {min, max}
  result: {contains: [FAILED]}  # tool_result seulement — sur la sortie texte
  source: interactive         # input seulement — string | string[] (égalité exacte)
```

Sémantique : clés combinées = ET ; `any` = OU gagnant immédiatement (inchangé) ;
`input`/`command`/`tool` inchangés.

### Validation au chargement (parseContextFile)

- `events` non vide ; **chaque événement doit être connu** (sinon erreur avec la
  liste des valides).
- `action.type` connu **et compatible avec l'événement** (sinon erreur expliquant
  les actions autorisées pour cet événement).

## Architecture (inchangée)

- `match.ts`, `engine.ts`, `frontmatter.ts` restent **sans import pi**.
- Le handler construit un `Subject` enrichi ; le moteur reste pur.
- `index.ts` : nouveaux handlers + dispatch des actions + journal d'activité.

## Tâches

### Tâche 1 — match.ts v2 : nouvelles dimensions (TDD)

`Subject` devient :

```ts
export type Subject = {
 text: string;
 tool?: string;
 command?: string;
 result?: string;      // tool_result : sortie texte
 model?: string;       // "provider/id"
 cwd?: string;
 sessionSize?: number;
 contextFill?: number; // 0-100
 source?: string;      // input : interactive|rpc|extension
};
```

Règles dans `matchRule` (après les clés v1, avant `return true`) :

```ts
if (m.model !== undefined) {
 const targets = Array.isArray(m.model) ? m.model.map(String) : [String(m.model)];
 if (!s.model || !targets.some((t) => s.model!.toLowerCase().includes(t.toLowerCase())))
  return false;
}
if (m.cwd !== undefined) {
 if (s.cwd === undefined || !matchPatterns(m.cwd, s.cwd)) return false;
}
if (m.sessionSize !== undefined && !matchCount(m.sessionSize, s.sessionSize)) return false;
if (m.contextFill !== undefined && !matchCount(m.contextFill, s.contextFill)) return false;
if (m.result !== undefined && !matchPatterns(m.result, s.result ?? "")) return false;
if (m.source !== undefined) {
 const targets = Array.isArray(m.source) ? m.source.map(String) : [String(m.source)];
 if (!s.source || !targets.includes(s.source)) return false;
}
```

avec `matchCount(spec: unknown, value: number | undefined)` : nombre → `value >= n` ;
objet `{min, max}` → bornes inclusives ; `undefined` → false.

Tests : model (provider seul, id seul, provider/id, liste, casse), cwd (contains,
regex, liste, absent), sessionSize (nombre, {min,max}, valeur absente), contextFill
(idem), result (contains/regex sur sortie), source (égalité exacte, liste, absent),
combinaisons ET, any inchangé.

### Tâche 2 — engine.ts v2 : actions, validation, sélection par événement (TDD)

`RuleAction` devient :

```ts
export type RuleAction = {
 type: "inject" | "confirm" | "block" | "modify" | "tools" | "notify" | "transform" | "handled" | "annotate";
 once?: boolean;
 message?: string;
 level?: "info" | "warning" | "error";
 command?: { append?: string; prepend?: string };
 enable?: string[];
 disable?: string[];
 text?: string;
 append?: string;
 details?: unknown;
};
```

Table de compatibilité événement → actions + liste des événements valides,
puis validation dans `parseContextFile` (jeter avec message clair).

Nouvelle sélection générique :

```ts
export function selectForEvent(rules: Rule[], subject: Subject, event: string): Rule[] {
 return rules.filter((r) => r.events.includes(event) && matchRule(r.match, subject));
}
```

`selectInject` / `selectToolRules` restent (tests v1 intacts) — `selectInject` peut
réutiliser `selectForEvent` en interne.

Tests : parse des 9 formes d'action ; événement inconnu → throw ; action
incompatible (ex : annotate sur input) → throw ; selectForEvent filtre par
événement + match ; priorité triée (inchangé).

### Tâche 3 — index.ts v2 : nouveaux handlers + dispatch (fake-pi harness)

Structure : `baseSubject(ctx)` enrichit le Subject (model, cwd, sessionSize,
contextFill) ; `notifyRule(ctx, r)` ; `applyTools(pi, r)` ; journal `activity`
(fin : {t, rule, event, action, detail}, plafonné à 100) ; `log(...)`.

- `input` : transform chaîné (chaque règle remplace le texte courant), handled =
  premier gagnant, + tools/notify ; retour `{action:"handled"}` ou
  `{action:"transform", text}` si modifié, sinon rien.
- `tool_result` : sortie texte = concat des `content` textuels ; annotate →
  patch `{content: [...event.content, {type:"text", text: append}], details: mergé}` ;
  inject → queue (livrée au `context` event, comme v1) ; notify.
- `user_bash` : block → `{result: {output, exitCode: 1, cancelled: false, truncated: false}}` ;
  confirm fail-safe sans UI ; modify → wrapper `createLocalBashOperations` avec
  prepend/append accumulés ; notify.
- `session_before_switch` / `session_before_fork` : block → `{cancel: true}` ;
  confirm → ui.confirm sinon `{cancel: true}`.
- `before_agent_start` / `tool_call` : switch étendu (tools, notify ; inject
  inchangé) + notifications quand une règle injecte ou bloque.
- `context` : inchangé.

Tests (harness fake-pi existant étendu) : transform/handled sur input ; annotate
sur tool_result (patch content+details) ; inject via tool_result livré au context
event ; user_bash block (result cancelled) et modify (ops.exec enveloppe) ;
session_before_switch/fork block et confirm refusé → cancel ; tools → setActiveTools
avec la bonne liste ; notify → ui.notify appelé ; comportement v1 intact (30 tests
existants).

### Tâche 4 — commande /nma (TDD)

```ts
pi.registerCommand("nma", {
 description: "Context Engine : /nma (liste), /nma reload, /nma status",
 handler: async (args, ctx) => {
  const cmd = args.trim().split(/\s+/)[0];
  if (cmd === "reload") { reload(ctx.cwd); ctx.ui.notify(`[nma] ${rules.length} règle(s) rechargée(s)`, "info"); return; }
  if (cmd === "status") {
   const counts = ...; // par action, derniers événements du journal
   ctx.ui.editor("nma status", ...); return;
  }
  // défaut : liste des règles
  ctx.ui.editor("nma rules", lignes par règle); // nom, events, action, priority, file, match résumé
 }
});
```

Tests : /nma rechargé relit le dossier (nouveau fichier → compté) ; /nma liste
contient les noms ; /nma status contient les injections/blocages du journal.

### Tâche 5 — skill v2

- `references/schema.md` : 9 actions + formes complètes, 7 événements, validation.
- `references/events.md` : table sujet/actions par événement (7).
- `references/actions.md` : 9 actions + matrice événement×action + options.
- `references/matching.md` : 8 clés + sémantique (model/cwd/sessionSize/contextFill/result/source).
- `references/tool-hooks.md` : user_bash (result cancelled, wrapper), gardes de
  session (cancel), tool_result (annotate/inject).
- `references/examples.md` : + exemples input transform/handled, tool_result annotate.
- `templates/` : + `input-transform.md`, `input-handled.md`, `tool-result-annotate.md`,
  `tool-result-inject.md`, `user-bash-guard.md`, `session-guard.md`, `tools-toggle.md`,
  `notify.md` (8 nouveaux).
- `SKILL.md` : description + workflow à jour.

### Tâche 6 — exemples, README, E2E, commit

- `.pi/context/` : + `input.md` (transform : préfixe consigne), `tool-result.md`
  (annotate après échec de test), `tools.md` (exemple prudent : activer un outil
  custom quand le sujet s'y prête — ne pas désactiver bash par défaut ici),
  `session-guard.md` (confirm sur /fork), `notify.md` (notify quand la règle
  git-safety agit).
- README : section v2 + commande /nma + nouvelles capacités.
- E2E réel (`pi --print` + mode TUI si possible) : input transform, user_bash
  block sur `!git push` (print mode : `!` pas dispo → vérifier via tool_call classique),
  `/nma` list.
- Commit final + sync du plan si le TDD révèle des corrections.

## Définition de done

- [ ] Tests v1 (30) + tests v2 tous verts (`node --test "*.test.ts"`).
- [ ] `tsc --noEmit` propre (racine + extension).
- [ ] Skill complètement à jour (toute nouvelle clé documentée + template).
- [ ] E2E réel : extension charge, injection fonctionne, garde bloque, `/nma` répond.
- [ ] Plan doc synchronisé avec les éventuelles corrections TDD.
- [ ] Mémoire projet (Progress.md) mise à jour.

## Roadmap (hors v2)

agent_end/relance automatique · action thinking · session_before_compact ·
outil context_rules · dimension git (nécessite exec, casse la pureté) ·
autocomplétion /nma · watcher de fichiers (reload auto).
