# CLI Reference

Miniloops exposes all functionality through a single binary with subcommands. The two invocation forms are equivalent:

```bash
# Via the bin wrapper (resolves the project directory automatically)
miniloops <subcommand> [args...]

# Via the Tonic runtime
tonic run <project-dir> <subcommand> [args...]
```

The `bin/miniloops` launcher is a thin shell wrapper that calls `tonic run` with the repo root as the project directory and forwards all arguments.

## Environment

| Variable | Purpose |
|----------|---------|
| `MINILOOPS_PROJECT_DIR` | Override the project directory for subcommands that default to `.` |
| `MINILOOPS_STATE_DIR` | State directory — used by the Pi adapter to write stream logs |
| `MINILOOPS_ITERATION` | Current iteration number — set by the harness during runs |
| `MINILOOPS_PROMPT` | Override the prompt sent to the backend |
| `MINILOOPS_PROMPT_PATH` | Fallback prompt file path when `MINILOOPS_PROMPT` is unset |
| `MINILOOPS_BIN` | Path to the miniloops binary — used by the Pi adapter for prompt projection |
| `MINILOOPS_REVIEW_MODE` | Set to `hyperagent` during review turns — changes the Pi stream log prefix |
| `MINILOOPS_MEMORY_FILE` | Exported by the harness so agents can locate the memory file |

## Subcommands

### `run`

Start a loop.

```bash
miniloops run [project-dir] [prompt...] [flags]
```

If `project-dir` is omitted it defaults to `.`. A positional argument is treated as a project directory only if it is an existing directory that contains `miniloops.toml` (or `miniloops.conf`); otherwise it is treated as a prompt.

**Flags:**

| Flag | Description |
|------|-------------|
| `-b <backend>`, `--backend <backend>` | Override the backend. `pi` selects the built-in Pi adapter. `claude` (or a path ending in `/claude`) adds `-p --dangerously-skip-permissions`. Any other value is treated as a shell command. |
| `-v`, `--verbose` | Enable verbose logging. |
| `--chain <steps>` | Run an inline chain instead of a single loop. `steps` is a comma-separated list of preset names (e.g. `autocode,autoqa,autoresearch`). |

**Examples:**

```bash
miniloops run .
miniloops run examples/autocode
miniloops run . "Fix the login bug" -b pi
miniloops run . --chain autocode,autoqa
```

### `emit`

Publish a coordination event to the journal.

```bash
miniloops emit <topic> [payload...]
```

The event is validated against the current iteration's allowed-event set. If the topic is not allowed and is not a built-in coordination topic, the emit is rejected and an `event.invalid` entry is written to the journal. Allowed events are derived from the topology's handoff map for the current role.

**Examples:**

```bash
miniloops emit doc.written "Wrote docs/cli.md covering all subcommands"
miniloops emit task.complete "All documentation gaps addressed"
```

### `inspect`

Read projected artifacts from the journal and state directory.

```bash
miniloops inspect <artifact> [selector] [project-dir] --format <md|text|json>
```

The `--format` flag is required.

**Artifacts:**

| Artifact | Selector | Formats | Description |
|----------|----------|---------|-------------|
| `scratchpad` | — | `md` | Scratchpad projection — concatenated outputs from the current run. |
| `prompt` | `<iteration>` | `md` | The full prompt that was sent to the backend for a given iteration. |
| `output` | `<iteration>` | `text` | The raw output returned by the backend for a given iteration. |
| `journal` | — | `json` | The full journal file contents. |
| `memory` | — | `md`, `json` | Materialized memory (`md`) or raw JSONL (`json`). |
| `coordination` | — | `md` | Coordination events from the current run. |
| `chain` | — | `md` | Chain state — steps, outcomes, lineage. |

**Examples:**

```bash
miniloops inspect scratchpad --format md
miniloops inspect prompt 5 --format md
miniloops inspect output 3 --format text
miniloops inspect journal --format json
miniloops inspect memory --format md
miniloops inspect coordination --format md
miniloops inspect chain --format md
```

### `memory`

Manage the loop's persistent memory store.

#### `memory list`

Print materialized memory entries.

```bash
miniloops memory list [project-dir]
```

#### `memory add learning`

Add a learning entry.

```bash
miniloops memory add learning <text...>
```

The entry is tagged with `source: "manual"`.

#### `memory add preference`

Add a categorized preference entry.

```bash
miniloops memory add preference <category> <text...>
```

#### `memory add meta`

Add a metadata entry.

```bash
miniloops memory add meta <key> <value...>
```

#### `memory remove`

Tombstone an entry by ID.

```bash
miniloops memory remove <id> [reason...]
```

If no reason is given, the source is recorded as `"manual"`.

### `chain`

Manage named chains defined in `chains.toml`.

#### `chain list`

List all defined chains and their steps.

```bash
miniloops chain list [project-dir]
```

Output shows each chain name followed by its step sequence (e.g. `code-and-qa: autocode -> autoqa`).

#### `chain run`

Run a named chain.

```bash
miniloops chain run <name> [project-dir]
```

The chain must be defined in `chains.toml`. Each step runs as an isolated loop in `.miniloops/chains/<chain-run-id>/step-<n>/`.

### `pi-adapter`

Run the Pi backend adapter directly. This is normally called by the harness, not by users.

```bash
miniloops pi-adapter [pi-command] [extra-args...]
```

The adapter resolves the prompt from `MINILOOPS_PROMPT`, then falls back to projecting it via `miniloops inspect prompt`, then falls back to reading `MINILOOPS_PROMPT_PATH`. It invokes Pi with `-p --mode json --no-session` plus any extra arguments, parses the NDJSON stream, and writes the raw stream to `.miniloops/pi-stream.<iteration>.jsonl` (or `pi-review.<iteration>.jsonl` in review mode).

## `bin/miniloops` launcher

The `bin/miniloops` shell script is a convenience wrapper:

```bash
#!/bin/sh
tonic run "$REPO_DIR" "$@"
```

It resolves the repository root from its own location, runs `tonic run` with that directory as the project, and forwards all remaining arguments. It traps `INT`/`TERM` to clean up the child process.
