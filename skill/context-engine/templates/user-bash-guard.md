---
name: <kebab-name>
description: <what and when — garde sur les commandes ! / !! tapées à la main>
events: [user_bash]
match:
  command: {regex: ["^<pattern>"]}
action:
  type: confirm
  message: "<avertissement visible>"
priority: high
---

Variantes : `type: block` pour bloquer sans dialogue ; `type: modify` avec
`command: {prepend: "...", append: "..."}` pour envelopper la commande.
