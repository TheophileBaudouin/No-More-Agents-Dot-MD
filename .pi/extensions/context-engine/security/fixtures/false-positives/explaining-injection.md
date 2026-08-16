# Understanding prompt injection

The attack vector is simple: an attacker writes "ignore previous instructions"
inside a retrieved document, hoping the model drops its guardrails. Defend by
treating document content as untrusted data, never as commands.
