# no-agents dot md

Replace the monolithic `AGENTS.md` with tiny declarative context files
(`.pi/context/*.md`) driven by a Pi extension. Each file is a micro-context:
the YAML frontmatter describes the behavior, the Markdown body is the context
the agent actually sees — injected only when it applies.

```text
.pi/
├── context/                 # behavior rules (copy into your project)
│   ├── ui.md                #   conditional context on UI/UX prompts
│   ├── git-safety.md        #   confirm destructive git commands
│   └── test-context.md      #   testing conventions after a test run
└── extensions/
    └── context-engine/      # the extension (copy into your project)
        ├── index.ts         #   event wiring
        ├── engine.ts        #   rule model + loader
        ├── match.ts         #   declarative matcher
        └── frontmatter.ts   #   YAML-subset parser
skill/context-engine/        # the skill (copy to ~/.pi/agent/skills/)
```

## Install

1. Copy the extension into your project:

   ```bash
   cp -r .pi/extensions/context-engine <project>/.pi/extensions/
   ```

2. Copy (or adapt) the example rules:

   ```bash
   cp -r .pi/context <project>/.pi/context
   ```

3. Install the skill globally:

   ```bash
   cp -r skill/context-engine ~/.pi/agent/skills/
   ```

4. Restart pi in the project. You should see:

   ```text
   [context-engine] 3 rule(s) loaded from .pi/context/
   ```

## Write a rule

Copy the closest template from `skill/context-engine/templates/` into
`.pi/context/<name>.md`, fill it in, restart pi. Full schema in
`skill/context-engine/references/schema.md`.

## Verify

- "improve the ui" → the UI conventions appear in the system prompt.
- `git push` → pi asks for confirmation.
- `pytest -x` → testing conventions show up right after the result.

## Test

```bash
cd .pi/extensions/context-engine && node --test "*.test.ts"
```

Zero npm dependencies; runs on Node ≥ 22.6 (native TS type-stripping).

## Roadmap

- `input` event (transform/handled) and `tool_result` reactions.
- File watching (reload rules on change instead of restart).
- `position: message` injection (a real injected message, not system prompt).
