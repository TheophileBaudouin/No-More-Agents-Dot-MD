---
name: test-failure-guidance
description: Conseils ajoutés au résultat quand un test échoue
events: [tool_result]
match:
  tool: bash
  command:
    contains: ["pytest", "vitest", "go test"]
  result:
    contains: ["FAILED", "Error"]
action:
  type: annotate
  append: "Échec de test : relance le test ciblé (ex. pytest tests/x.py::test_name), corrige uniquement ce cas, puis relance le fichier complet."
---
