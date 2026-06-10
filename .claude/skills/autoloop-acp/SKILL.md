---
name: autoloop-acp
description: Drive autoloop over the Agent Client Protocol (ACP) — connect an external editor, harness, or agent to `autoloop acp` over stdio, send prompts/slash commands that map to autoloop verbs, and stream loop runs as tool calls. Use when wiring up or operating an ACP connection to autoloop from another system.
argument-hint: [connect|run|<slash-command>] [args...]
---

# Autoloop over ACP

`autoloop acp` presents an **Agent Client Protocol** (ACP) interface over stdio. The external system (an editor, harness, or another agent) is the ACP **client**; autoloop is the ACP **agent**. This skill is for setting up that connection and driving autoloop through it. Parse `$ARGUMENTS` to determine what the user needs; if ambiguous, ask.

> Direction matters. This skill is about **other systems driving autoloop** (autoloop is the agent). The inverse — autoloop *consuming* an external ACP agent as a backend — is the separate `-b kiro` option and is **not** what this covers.

## Launching the agent

```bash
# Start the ACP agent on stdio (the client spawns this as a subprocess)
autoloop acp

# Surface debug logs as agent thoughts
autoloop acp --verbose      # or -v

# Usage
autoloop acp --help         # or -h
```

**Transport rules (important):**
- Frames are **NDJSON over stdio**. **Stdout is the protocol channel** — nothing else may write to it. All logs go to **stderr**.
- The client therefore launches `autoloop acp` as a subprocess and speaks ACP on stdin/stdout. Don't pipe other output into stdout.

**Working directory (REQUIRED):** per session. The ACP client **must** set it via the `session/new` `cwd` field, as the absolute path of the target project directory. autoloop anchors **all run state** (journal, registry, `runs/`) on `cwd`. If `cwd` is missing or blank, `session/new` is **rejected** with a JSON-RPC `invalid params` error — autoloop does **not** silently fall back to its own launch directory, because doing so would misroute the entire run into the wrong project. `--project-dir` / `AUTOLOOP_PROJECT_DIR` only affect dashboard control; they are not a fallback for the session working directory.

### Representative client config

ACP clients differ, but they spawn the agent as a command + args. A generic entry looks like:

```json
{
  "command": "autoloop",
  "args": ["acp"]
}
```

Add `"--verbose"` to `args` if needed. The client **must** send a valid `cwd` on `session/new` (see Working directory above). No authentication step is required — `authenticate` is a no-op because autoloop runs locally under the caller's own credentials.

## What the client sees

On `initialize`, autoloop reports:
- `agentInfo`: `{ name: "autoloop", version: "0.1.0" }`
- `agentCapabilities`: `{ loadSession: false }` — sessions are not resumable; one session lives for the life of the connection and can launch many runs and quick commands over successive prompt turns.

On `session/new`, autoloop **requires** a valid `cwd` (rejecting the session otherwise) and advertises its verbs as **slash commands** (`available_commands_update`), each with a description and an input hint.

## Prompt behaviour

Each prompt turn's text is dispatched as an autoloop command line:

- **Bare objective** (no recognised verb) → runs the default preset: `run autocode "<your prompt>"`. So sending `build the login page` starts an `autocode` loop on that objective.
- **Explicit verb** or **`/slash` command** always overrides the default (e.g. `run autofix "..."`, `/loops`, `inspect scratchpad`).
- A single outer **XML-ish wrapper** is stripped before parsing — `<user_message>`, `<user>`, `<message>`, `<query>`, or `<prompt>`. This makes model-driven clients that wrap prompts work transparently. Unrecognised tags are left untouched.
- Tokenising honours single and double quotes, so quoted objectives with spaces survive: `run autocode "Fix the login bug"`.
- An empty prompt returns help text.

## Command surface

All 14 verbs work both as bare prompt lines and as `/slash` commands. They run in one of three modes:

### Stream mode — long-running loops, streamed as ACP tool calls

| Verb | Hint | Description |
|---|---|---|
| `run` | `<preset> [objective] [flags]` | Start a loop with a preset (e.g. `run autocode "Fix bug"`) |
| `chain` | `<list\|run> [args]` | Run or list chains of presets |

These execute a loop and bridge its events onto ACP `session/update` notifications as tool calls. The turn ends with a summary message.

### Capture mode — quick commands, returns captured text

| Verb | Hint | Description |
|---|---|---|
| `loops` | `[--all\|show <id>\|artifacts <id>\|health]` | List active/recent runs or show/health a run |
| `inspect` | `<artifact> [selector] [--format <fmt>]` | Inspect a run artifact (journal, scratchpad, metrics, ...) |
| `guide` | `[--run <id>] <message>` | Inject operator guidance into the next iteration of a run |
| `list` | | List available presets |
| `memory` | `<list\|status\|find\|add\|remove> [args]` | Manage persistent loop memory |
| `task` | `<add\|complete\|update\|remove\|list> [args]` | Manage loop tasks |
| `worktree` | `<list\|show\|merge\|clean> [args]` | Manage git worktrees for isolated runs |
| `runs` | `clean [--max-age <days>]` | Maintain run directories |
| `config` | `<show\|set\|unset\|path> [args]` | Show or edit autoloop configuration |
| `control` | `<show\|capabilities\|interrupt\|guide> <id>` | Inspect or control a live run |
| `emit` | `<topic> [summary]` | Emit a coordination topic event into a run |

These run synchronously with stdout/stderr captured and return the text as a single agent message.

### Control mode — dashboard lifecycle

| Verb | Hint | Description |
|---|---|---|
| `dashboard` | `[start\|stop\|status] [--port <port>] [--host <host>]` | Start/stop the local dashboard and return its URL |

Handled directly by the agent. On start, the dashboard **URL is returned on its own line** so clients can linkify it.

## Streaming & cancellation

- **Stream verbs** (`run`, `chain`) emit live `session/update` notifications as the loop runs, then a final summary with a stop reason.
- **Capture verbs** return their full captured output in one message.
- Cancel an in-flight turn with the ACP **`session/cancel`** notification — it aborts the active turn (and the running loop) for that session.

## Quick reference

| The client wants to... | Send this prompt |
|---|---|
| Start a feature loop | `run autocode "..."` (or just the bare objective) |
| Fix a bug | `run autofix "..."` |
| List/inspect runs | `loops` / `loops show <id>` / `inspect scratchpad` |
| Steer a running loop | `guide "..."` |
| List presets | `list` |
| Open the dashboard | `dashboard start` (URL returned on its own line) |
| Cancel the current turn | ACP `session/cancel` notification |
