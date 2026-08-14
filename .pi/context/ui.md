---
name: ui-context
description: Conventions UI, injected when the prompt mentions UI/UX
events: [before_agent_start]
match:
  input:
    contains: [ui, ux, "interface utilisateur", "user interface"]
action:
  type: inject
  once: true
---

# UI Conventions

## Composants

- Réutilise les composants existants dans `src/lib/components/` avant d'en écrire de nouveaux.
- Fais un `grep`/`symbol_search` du nom avant d'ajouter un composant qui pourrait déjà exister (bouton, input, modal, badge…).
- Prends les composants d'interface depuis la lib existante (shadcn-svelte, etc.) plutôt que de les réinventer.

## Code

- Préfère les runes Svelte 5 (`$state`, `$derived`, `$props`) aux déclarations réactives héritées (`let:` / `reactive`).
- Un composant = un fichier. Nom en PascalCase (`UserCard.svelte`).
- Garde la logique dans le composant : pas de CSS `:global()` sauf cas documenté.

## Textes

- Chaînes visibles par l'utilisateur en **français**.
- Identifiants, variables, classes, composants en **anglais**.
- L'accessibilité compte : `aria-label` sur les boutons icônes, `<label>` lié à chaque champ.

## Style

- Utilise les tokens de design (couleurs, espacements, typo) existants — pas de couleurs en dur.
- Grille et espacement via les utilitaires déjà présents (Tailwind, etc.) ; ne réintroduis pas de spacing ad hoc.

## Etat & données

- Les appels réseau passent par la couche data existante (fetchers, stores, TanStack Query…) ; pas de `fetch` brut éparpillé dans les composants.
- Un état local d'UI ($state) ne remplace pas un état applicatif partagé là où plusieurs composants en dépendent.
