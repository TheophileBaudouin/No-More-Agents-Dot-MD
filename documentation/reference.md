# Reference — the full contract

This is the authoritative schema for rule files, the `/nma` command, and the
validation rules. For a gentler introduction, see [Writing rules](writing-rules.md).

## Rule file

A rule is a Markdown file in `.pi/context/`. Everything above the first
`---` (a YAML frontmatter) describes behavior; the body below is the context
that may be injected. The frontmatter is **never** injected.

```yaml
name: string            # required, unique among loaded rules
description: string     # optional — shown by /nma, fallback for messages
events: [string]        # required — 1+ of the 7 valid events (below)
match: object           # optional — if absent, the rule applies always
  <key>: match-value    #   10 keys, semantics below
action:                 # required
  type: string          #   one of the 9 actions (below)
  ...options            #   action-specific options
priority: low|normal|high   # optional — default normal; high wins
once: true|false            # optional — inject at most once per session
```

### The 7 events

| Event | Fires when | Subject available |
| --- | --- | --- |
| `before_agent_start` | a new agent run starts | the user prompt |
| `tool_call` | a tool is about to run | tool name, input (as JSON), `command` |
| `tool_result` | a tool just returned | tool name, output text (`result`), `command` |
| `input` | raw user input arrives | the input text, `source` |
| `user_bash` | the user runs `!` / `!!` manually | the command text |
| `session_before_switch` | `/new`, `/resume`, `/clone` | `reason` (`new` \| `resume`) |
| `session_before_fork` | `/fork` | `position` (`before` \| `at`) |

### The 9 actions

| Action | Event compatibility | Options | Effect |
| --- | --- | --- | --- |
| `inject` | `before_agent_start`, `tool_call`, `tool_result` | — (body is the content) | Queues the body into the agent's context |
| `confirm` | `tool_call`, `user_bash`, `session_before_switch`, `session_before_fork` | `message` | Asks the human; decline → blocked |
| `block` | `tool_call`, `user_bash`, `session_before_switch`, `session_before_fork` | `message` | Refuses outright |
| `modify` | `tool_call`, `user_bash` | `command: {prepend, append}` | Rewrites the command before it runs |
| `tools` | `before_agent_start`, `tool_call`, `input` | `enable: [names]`, `disable: [names]` | Adds/removes tools for the session |
| `notify` | all events | `message`, `level: info\|warning\|error` | Shows a pi notification |
| `transform` | `input` | `text` | Replaces the user input |
| `handled` | `input` | — | Answers without calling the LLM |
| `annotate` | `tool_result` | `append`, `details: {…}` | Appends text/details to the tool result |

**`confirm` fail-safe rule:** when there is no UI (headless/RPC), `confirm`
behaves as **block** — it never silently allows. This is deliberate.

**`modify` mechanics:** with a `prepend`, the original command is prefixed;
with an `append`, it is suffixed. On `tool_call` the input is rewritten in
place; on `user_bash` the engine returns a wrapper that runs the composed
command.

### The 10 match keys

All match values accept: a **string** (substring, case-insensitive), a **list**
of strings (any-of), `{contains: [...]}` (any-of), or `{regex: [...]}` (any-of,
full RegExp match).

| Key | Subject field | Notes |
| --- | --- | --- |
| `input` | prompt / tool args JSON / raw input | the main text dimension |
| `command` | shell command | `tool_call`, `tool_result`, `user_bash` |
| `tool` | tool name | exact |
| `result` | tool output text | `tool_result` |
| `model` | `provider/id` of the active model | contains, case-insensitive |
| `cwd` | current working directory | contains |
| `sessionSize` | session entries count | number = "at least N"; or `{min, max}` |
| `contextFill` | context usage, % | number = "at least N"; or `{min, max}` |
| `source` | input origin | exact: `interactive` \| `rpc` \| `extension` |
| `any` | — | OR of other match objects |

### Priority and conflicts

Rules are applied in `priority` order (`high` first, then `normal`, `low`).
Within a single event, `selectForEvent` returns rules sorted by priority, then
declaration order. `once: true` guarantees the rule fires at most once per
session (tracked per rule name).

## Validation (at load time)

Each file is parsed and validated when `.pi/context/` is loaded (session start
or `/nma reload`). A file that fails **is skipped** with a clear console
message naming the file and the problem:

- unknown `event` (not in the 7);
- unknown `action.type`;
- **incompatible** event/action combination (e.g. `annotate` on `tool_call`,
  `handled` on `tool_result`);
- malformed frontmatter (YAML-subset parse error).

A single bad file never breaks the other rules.

## The `/nma` command

Registered by the extension; usable inside pi (TUI):

| Command | Effect |
| --- | --- |
| `/nma` | List loaded rules: name, events, action type, priority, file, match summary |
| `/nma reload` | Re-read `.pi/context/` — no restart needed; confirms via notification |
| `/nma status` | Session activity: loaded count, `once` injections, pending context, per-action counters, last 10 journal entries |

## Automatic notifications

The engine also informs you without being asked (only when a UI is present):

- a rule **injects** context → notification `[nma] <name>: context injected`;
- a rule **blocks** (or a confirmation is declined) → notification
  `[nma] <name>: blocked`.

## Engine internals (map of the code)

| File | Responsibility |
| --- | --- |
| `frontmatter.ts` | YAML-subset parser (zero dependencies) |
| `match.ts` | the 10 match keys, pure — no pi imports |
| `engine.ts` | rule model, loader, validation, `selectForEvent` — pure |
| `index.ts` | pi wiring: subjects, handlers, `/nma` — the only file importing pi |

Everything a rule can say is in this page. If a capability is not listed here,
it does not exist yet — see [Architecture](architecture.md) for how to extend.
