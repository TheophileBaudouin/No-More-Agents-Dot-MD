---
name: <kebab-name>
description: <what and when — la saisie est consommée, l'agent ne tourne pas>
events: [input]
match:
  input: {contains: ["<trigger>"]}
action: {type: handled}
---

Optionnel : ajoutez une règle `notify` (même événement) pour un retour visible,
ex. action: {type: notify, message: "pong"}.
