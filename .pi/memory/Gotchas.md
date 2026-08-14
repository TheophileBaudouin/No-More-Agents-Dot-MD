# Gotchas — no-agents dot md

## Infrastructure / outils

- **Repo path avec espaces** : `"/Users/theophilebaudouin/Documents/devellopement/no-agents dot md"` — quoter tous les chemins shell.
- **macOS : pas de `timeout`** — pas de wrapper `timeout` pour les commandes longues.
- **Tests** : `node --test "*.test.ts"` (le glob est requis — la découverte de répertoire n'inclut PAS `.ts`).
- **LSP pi-lens** : utilise le typescript bundlé de `~/.pi-lens/tools/` (upgradé 4.9.5 → 5.9.3 — `allowImportingTsExtensions` exige TS ≥ 5.0) et lance tsc avec cwd = racine du repo → tsconfig racine requis (extends l'extension + typeRoots vers `node_modules/@types`).
- **lens_diagnostics peut servir un état en cache** (y compris mode=full) — pour une analyse fraîche : tuer les processus `typescript-language-server`/`tsserver.js`, `touch *.ts`, puis lsp_diagnostics.
- **Pi-lens auto-format les fichiers** (markdownlint, prettier) → toujours relire un fichier avant de l'éditer après une écriture.
- Un processus automatisé a déjà ajouté `docs/` au `.gitignore` sans demande — vérifier `.gitignore` avant tout commit.
- Le check automatisé pi-lens peut signaler des erreurs intermédiaires pendant une édition (analyse pendant l'écriture) — se fier au scan final.

## SDK pi (faits vérifiés)

- `AgentMessage` n'a PAS de rôle "system" (UserMessage | AssistantMessage | ToolResultMessage | custom) → l'injection de contexte passe par un message `user` + `timestamp`.
- `event.input` de tool_call est mutable ; pas de re-validation après mutation.
- `confirm` sans UI (`ctx.hasUI === false`) : l'extension doit bloquer fail-safe.
- `context` event : `event.messages` est une copie profonde, modifiable.
- `user_bash` : bloquer = retourner `{result: {output, exitCode, cancelled: true}}` ; modifier = wrapper `createLocalBashOperations`.
- `session_before_switch`/`session_before_fork` : `{cancel: true}` annule.
- `input` : `{action: "transform", text}` / `{action: "handled"}` / `{action: "continue"}` ; les transforms chaînent entre handlers.
- `tool_result` : patch partiel retournable (`content`, `details`, `isError`, `usage`).
- Extensions en sous-répertoire : `.pi/extensions/*/index.ts` ; package.json avec `pi.extensions` pour les devDeps types.

## V1 — bugs réels trouvés par le TDD (corrigés, plan synchronisé)

- `inner.split(",")` cassait les maps inline contenant des listes → `splitTopLevel()` bracket-aware.
- `matchRule` avec un `any` non-matching retombait sur `return true` → `return false` si aucune autre clé.
- Handler `context` qui injectait `role: "system"` (invalide) → `role: "user"`.

## Sous-agents (v1)

- Le modèle subagent par défaut résolvait vers qwen (401 auth cassée) → override
  `deepseek/deepseek-v4-flash` requis. Les artefacts vivent dans `.pi/subagents/` (git-ignoré).
