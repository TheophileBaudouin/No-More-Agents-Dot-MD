---
name: review-shorthand
description: Transforme le raccourci « !review » en demande de revue complète
events: [input]
match:
  input: {contains: ["!review"]}
action:
  type: transform
  text: "Fais une revue de code du dernier commit : lis le diff, identifie les bugs, les problèmes de style et les tests manquants, puis propose des corrections précises."
---

Note : `transform` remplace toute la saisie (pas de placeholder en v2) — la
règle doit donc produire un texte complet et autonome.
