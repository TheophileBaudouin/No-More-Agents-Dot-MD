# Installation

The engine is made of two parts:

- an **extension** (`.pi/extensions/context-engine/`) — the code that listens to
  events and applies rules;
- a **skill** (`skill/context-engine/`) — the instruction set that helps your
  agent *write* new rules correctly, with templates.

You need **pi** itself. Install it once from
[pi.dev](https://pi.dev) or follow the pi quickstart.

## One-command install (recommended)

```bash
pi install git:github.com/TheophileBaudouin/No-More-Agents-Dot-MD
```

That installs the extension **and** the skill into pi's user settings, so it
works in **every project** you open. If you prefer HTTPS:

```bash
pi install https://github.com/TheophileBaudouin/No-More-Agents-Dot-MD
```

> **Security note:** pi packages run with full system access, like any pi
> extension. This package has **zero runtime dependencies** and makes **no
> network calls at load time** — it reads `.pi/context/` and reacts to session
> events. Two behaviors can touch the network: on install commands the
> scanner queries the npm registry + OSV unless `NMA_NETWORK=0` (which
> disables all network calls), and an opt-in URLhaus host-reputation check
> on shell commands that reference public http(s) URLs (`NMA_URLHAUS_KEY`,
> off by default; `NMA_NETWORK=0` disables it too). It also writes a small
> trust file (`~/.pi/agent/nma-trust.json`). Still, the usual rule applies:
> review
> source code before trusting any third-party package.

### What the install does NOT do

It installs the *engine* and the *skill*, but **not** the rules themselves.
Rules are project-specific by nature. The repository ships no rules at all:
`.pi/context/` is entirely yours. Two ways to get started:

1. **Write your own** — copy a template, fill it in. Ask your agent
   "add a context rule for X" — the skill creates `.pi/context/` when missing
   and makes writing rules reliable. Start with
   [Writing rules](writing-rules.md).
2. **Copy a recipe** — every recipe in [Examples](examples.md) is a complete
   rule file: create `.pi/context/` (`mkdir -p .pi/context`), copy the recipe
   into `.pi/context/<name>.md`, and adapt it.

## Manual install (no package manager)

Copy the two folders into your project, then restart pi in that project:

```bash
# inside your project directory
mkdir -p .pi/extensions
cp -r <repo>/.pi/extensions/context-engine .pi/extensions/
mkdir -p ~/.pi/agent/skills
cp -r <repo>/skill/context-engine ~/.pi/agent/skills/
```

## Verify it works

Start pi in the project. With no rules yet, the engine loads silently — it
only logs when rules exist (e.g. `[No More Agents Dot MD] 2 rule(s) loaded
from .pi/context/`). That silence is normal on a fresh install: the repository
ships no rules, and `.pi/context/` does not exist yet. The count goes up as you
write rules (see [Writing rules](writing-rules.md)). The engine does not
complain — it just waits. That's fine: rules are optional.

Then try the built-in `/nma` command inside pi:

```text
/nma            → list the loaded rules
/nma reload     → reload rules without restarting pi
/nma status     → what fired this session
/nma security   → per-file scan level, load state, trust state, findings
/nma trust <file> [--yes] → scan + approve a rule file
/nma untrust <file>       → revoke an approval, reload immediately
/nma convert [file] [--yes] → split an AGENTS.md into atomic rules (the agent writes them)
/nma import <name|keywords> [--yes] → import a rule from the community registry
/nma share      → open the community submission form
```

## Your first rule, in 60 seconds

1. Create the folder: `mkdir -p .pi/context`
   (or skip it — the agent creates it when you ask for a rule)
2. Create `.pi/context/hello.md`:

   ```markdown
   ---
   name: hello
   description: Say hi when the user greets you
   events: [before_agent_start]
   match:
     input: {contains: ["hello"]}
   action:
     type: inject
   ---

   # Project note

   This project loves short, kind replies.
   ```

3. Inside pi, run `/nma reload`, then type "hello".
   The agent should greet you **and** keep your note in mind.

That's the whole loop. Everything else is just variations on
event → match → action. The [guide](writing-rules.md) takes you deeper.

## Project-local copy vs global install

If the extension is present in both `.pi/extensions/` (e.g. when developing
inside the repo) and as a globally installed npm package, pi would load it
twice. A process-wide singleton guard prevents that: the **first loaded copy
wins** (pi loads project-local first, so the dev copy wins while developing;
the npm copy wins everywhere else) and the other copy registers nothing —
`/nma` and all event handlers exist exactly once. Run `/nma status` to see
which copy is active ("Active copy: …").
