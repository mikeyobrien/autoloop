# CLI Reference

The CLI is a thin shell over the autoloops-ts control plane. It launches runs, inspects artifacts, and manages memory and chains — but contains no loop logic itself. See [Platform Architecture](platform.md) for how the CLI fits into the broader system.

autoloops-ts exposes all functionality through a single binary with subcommands.

```bash
# Via npm/node
node bin/autoloops-ts <subcommand> [args...]

# Or if installed globally / via npx
autoloops-ts <subcommand> [args...]
```

## Environment

| Variable | Purpose |
|----------|---------|
| `MINILOOPS_PROJECT_DIR` | Override the project directory for subcommands that default to `.` |
| `MINILOOPS_STATE_DIR` | State directory — used by the Pi adapter to write stream logs |
| `MINILOOPS_ITERATION` | Current iteration number — set by the harness during runs |
| `MINILOOPS_PROMPT` | Override the prompt sent to the backend |
| `MINILOOPS_PROMPT_PATH` | Fallback prompt file path when `MINILOOPS_PROMPT` is unset |
| `MINILOOPS_BIN` | Path to the autoloops binary — used by the Pi adapter for prompt projection |
| `MINILOOPS_LOG_LEVEL` | Current log level — exported by the harness. One of `debug`, `info`, `warn`, `error`, `none`. |
| `MINILOOPS_REVIEW_MODE` | Set to `metareview` during review turns — changes the Pi stream log prefix |
| `MINILOOPS_MEMORY_FILE` | Exported by the harness so agents can locate the memory file |

## Subcommands

### `run`

Start a loop.

```bash
autoloops-ts run <preset-name|preset-dir> [prompt...] [flags]
```

The preset argument is required. It must be one of:
- A bundled preset name (e.g. `autocode`, `autoqa`) — resolved to `examples/<name>/` under the installed project.
- An explicit path to a directory containing `autoloops.toml` (or `autoloops.conf`).
- `.` to run from the current directory.

If the preset argument is missing, the CLI exits with a usage error. If the argument does not resolve to a valid preset directory or bundled preset name, the CLI exits with a resolution error. Unknown arguments are never silently reinterpreted as prompt text.

**Flags:**

| Flag | Description |
|------|-------------|
| `-b <backend>`, `--backend <backend>` | Override the backend. `pi` selects the built-in Pi adapter. `claude` (or a path ending in `/claude`) adds `-p --dangerously-skip-permissions`. Any other value is treated as a shell command. |
| `-p <preset>`, `--preset <preset>` | Resolve a bundled preset name (for example `autocode`) or use an explicit custom preset directory. Useful when you want the prompt to start with path-like text or avoid positional ambiguity. |
| `-v`, `--verbose` | Enable verbose logging. |
| `--chain <steps>` | Run an inline chain instead of a single loop. `steps` is a comma-separated list of preset names (e.g. `autocode,autoqa,autoresearch`). |

**Examples:**

```bash
autoloops-ts run autocode
autoloops-ts run autocode "Fix the login bug"
autoloops-ts run --preset autocode "Fix the login bug"
autoloops-ts run . "Fix the login bug" -b pi
autoloops-ts run . --chain autocode,autoqa "Implement the approved change and validate it"
```

### `emit`

Publish a coordination event to the journal.

```bash
autoloops-ts emit <topic> [payload...]
```

The event is validated against the current iteration's allowed-event set. If the topic is not allowed and is not a built-in coordination topic, the emit is rejected and an `event.invalid` entry is written to the journal. Allowed events are derived from the topology's handoff map for the current role.

**Examples:**

```bash
autoloops-ts emit doc.written "Wrote docs/cli.md covering all subcommands"
autoloops-ts emit task.complete "All documentation gaps addressed"
```

### `inspect`

Read projected artifacts from the journal and state directory.

```bash
autoloops-ts inspect <artifact> [selector] [project-dir] [--format <md|terminal|text|json|csv>]
```

If `--format` is omitted, inspect uses artifact-specific defaults:

- `scratchpad`, `prompt`, `memory`, `coordination`, `chain`, `metrics` → `terminal`
- `output` → `text`
- `journal` → `json`

**Artifacts:**

| Artifact | Selector | Formats | Description |
|----------|----------|---------|-------------|
| `scratchpad` | — | `md`, `terminal` | Rich scratchpad projection for the current run. Prompt/review rendering uses a more compact view. `terminal` pretty-renders the markdown for a terminal. |
| `prompt` | `<iteration>` | `md`, `terminal` | The full prompt that was sent to the backend for a given iteration. `terminal` pretty-renders the markdown for a terminal. |
| `output` | `<iteration>` | `text` | The raw output returned by the backend for a given iteration. |
| `journal` | — | `json` | The full journal file contents. |
| `memory` | — | `md`, `terminal`, `json` | Materialized memory (`md`), terminal-rendered markdown (`terminal`), or raw JSONL (`json`). |
| `metrics` | `[run_id]` | `md`, `terminal`, `csv`, `json` | Per-iteration metrics table: role, event, elapsed time, exit code, outcome. Optional `run_id` selector filters to a specific run. `terminal` pretty-renders the markdown table for a terminal. |
| `coordination` | — | `md`, `terminal` | Coordination events from the current run. `terminal` pretty-renders the markdown for a terminal. |
| `chain` | — | `md`, `terminal` | Chain state — steps, outcomes, lineage. `terminal` pretty-renders the markdown for a terminal. |

**Metrics output formats:**

The `metrics` artifact produces a per-iteration table with columns: `iteration`, `role`, `event`, `elapsed_s`, `exit_code`, `timed_out`, `outcome`.

- **`md`** — Markdown table followed by a summary line: total iterations, total elapsed seconds, and count of distinct events.
- **`terminal`** — The same markdown table rendered for terminal display with ANSI styling.
- **`csv`** — RFC 4180 CSV with header row. Fields containing commas, quotes, or newlines are double-quoted.
- **`json`** — JSON array of objects. Numeric fields (`iteration`, `elapsed_s`, `exit_code`) are numbers or `null`. `timed_out` is a boolean.

When no metrics data exists, `md` outputs `"No metrics data available."`, `csv` outputs the header row only, and `json` outputs `[]`.

**Examples:**

```bash
autoloops-ts inspect scratchpad                    # defaults to terminal
autoloops-ts inspect scratchpad --format md
autoloops-ts inspect prompt 5                     # defaults to terminal
autoloops-ts inspect prompt 5 --format md
autoloops-ts inspect output 3                     # defaults to text
autoloops-ts inspect journal                      # defaults to json
autoloops-ts inspect memory                       # defaults to terminal
autoloops-ts inspect memory --format md
autoloops-ts inspect coordination                 # defaults to terminal
autoloops-ts inspect chain                        # defaults to terminal
autoloops-ts inspect metrics                      # defaults to terminal
autoloops-ts inspect metrics --format md
autoloops-ts inspect metrics --format csv
autoloops-ts inspect metrics --format json
autoloops-ts inspect metrics run-mn9d3uk0-xi0m --format md
```

### `memory`

Manage the loop's persistent memory store.

#### `memory list`

Print materialized memory entries with stable IDs.

```bash
autoloops-ts memory list [project-dir]
```

#### `memory status`

Print rendered size, configured budget, and active entry counts.

```bash
autoloops-ts memory status [project-dir]
```

#### `memory find`

Search active memory entries by text, category, key/value, source, or ID.

```bash
autoloops-ts memory find <pattern...>
```

#### `memory add learning`

Add a learning entry.

```bash
autoloops-ts memory add learning <text...>
```

The entry is tagged with `source: "manual"`.

If the new entry pushes rendered memory over `memory.prompt_budget_chars`, the CLI warns that the prompt memory will be truncated.

#### `memory add preference`

Add a categorized preference entry.

```bash
autoloops-ts memory add preference <category> <text...>
```

#### `memory add meta`

Add a metadata entry.

```bash
autoloops-ts memory add meta <key> <value...>
```

#### `memory remove`

Tombstone an entry by ID.

```bash
autoloops-ts memory remove <id> [reason...]
```

If no reason is given, the source is recorded as `"manual"`.

If the target ID is missing or already inactive, the CLI prints a warning instead of appending a no-op tombstone.

### `chain`

Manage named chains defined in `chains.toml`.

#### `chain list`

List all defined chains and their steps.

```bash
autoloops-ts chain list [project-dir]
```

Output shows each chain name followed by its step sequence (e.g. `code-and-qa: autocode -> autoqa`).

#### `chain run`

Run a named chain.

```bash
autoloops-ts chain run <name> [project-dir] [prompt...]
```

The chain must be defined in `chains.toml`. Each step runs as an isolated loop in `.autoloop/chains/<chain-run-id>/step-<n>/`. When a prompt is provided, it is passed directly to step 1 and also written into each step's `handoff.md` as the chain entry objective. Chains advance on bounded-success stops (`completion_event`, `completion_promise`, or `max_iterations`) and stop only on real failure reasons such as backend errors or timeouts.

### `loops`

Operator surface for listing and inspecting runs. Reads from the run registry (`{projectDir}/.autoloop/registry.jsonl`), which is updated by the harness at lifecycle milestones.

#### `loops`

List active (running) loops.

```bash
autoloops-ts loops
```

Output is a concise table with columns: run ID, status, preset, iteration count, latest event, and last updated timestamp. When no runs are active, prints `No active runs.`.

#### `loops --all`

List all runs (any status), most recent first.

```bash
autoloops-ts loops --all
```

#### `loops show <run-id>`

Show detailed information for a single run.

```bash
autoloops-ts loops show <run-id>
```

Displays: run ID, status, preset, objective, trigger, backend, iteration, latest event, stop reason (if terminal), created/updated timestamps, work directory, and state directory.

Partial run-ID matching is supported: if the given string is a unique prefix of a run ID, that run is shown. If the prefix is ambiguous, all matching run IDs are listed.

#### `loops artifacts <run-id>`

Show artifact file paths for a run.

```bash
autoloops-ts loops artifacts <run-id>
```

Displays paths to the journal file, registry file, state directory, and work directory. Supports the same partial run-ID matching as `loops show`.

#### `loops watch <run-id>`

Watch a run live by polling the registry.

```bash
autoloops-ts loops watch <run-id>
```

Polls the registry every 2 seconds and prints a compact progress line whenever the run's state changes (iteration, event, or status). When the run reaches a terminal status (completed, failed, timed_out, stopped), prints a full detail view and exits.

If the run is already in a terminal state when watch starts, prints the detail view immediately and exits. Supports partial run-ID matching.

Press Ctrl+C to stop watching.

#### `loops health`

Print an exception-focused health summary of all runs.

```bash
autoloops-ts loops health [--verbose]
```

Reads the registry and categorizes runs:
- **Active**: currently running and recently updated
- **Stuck**: running but no registry update in the last 10 minutes
- **Failed**: failed or timed out within the last 24 hours
- **Completed**: completed within the last 24 hours (suppressed by default)

When no exceptions exist, prints a one-line "All clear" summary. When exceptions exist, prints them grouped by category with a table header. Pass `--verbose` to also list recent completions.

Designed for cron jobs and chat delivery: call this one command and forward the output.

**Examples:**

```bash
autoloops-ts loops                              # active runs
autoloops-ts loops --all                        # all runs
autoloops-ts loops show run-mn9d3uk0-xi0m       # full run ID
autoloops-ts loops show run-mn9d                # partial match
autoloops-ts loops artifacts run-mn9d3uk0-xi0m  # artifact paths
autoloops-ts loops watch run-mn9d3uk0-xi0m      # live watch
autoloops-ts loops health                       # exception summary
autoloops-ts loops health --verbose             # include completions
```

### `pi-adapter`

Run the Pi backend adapter directly. This is normally called by the harness, not by users.

```bash
autoloops-ts pi-adapter [pi-command] [extra-args...]
```

The adapter resolves the prompt from `MINILOOPS_PROMPT`, then falls back to projecting it via `autoloops-ts inspect prompt`, then falls back to reading `MINILOOPS_PROMPT_PATH`. It invokes Pi with `-p --mode json --no-session` plus any extra arguments, parses the NDJSON stream, and writes the raw stream to `.autoloop/pi-stream.<iteration>.jsonl` (or `pi-review.<iteration>.jsonl` in review mode).

## Testing

Run the test suite via [Vitest](https://vitest.dev/):

```bash
npm test
```

### Mock backend

A deterministic mock backend is included for tests and local debugging.
It reads a JSON fixture file and replays the specified output, exit code,
and optional event emission — no live LLM backend required.

```bash
# Run a loop with the mock backend
autoloops-ts run . -b "node dist/testing/mock-backend.js" \
  MOCK_FIXTURE_PATH=test/fixtures/backend/complete-success.json

# Or set the env var separately
export MOCK_FIXTURE_PATH=test/fixtures/backend/complete-success.json
autoloops-ts run . -b "node dist/testing/mock-backend.js"
```

Fixture schema:

```json
{
  "output": "text printed to stdout",
  "exit_code": 0,
  "delay_ms": 0,
  "emit_event": "task.complete",
  "emit_payload": "done"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `output` | string | yes | Text printed to stdout |
| `exit_code` | number | yes | Process exit code |
| `delay_ms` | number | no | Delay before output (for timeout testing) |
| `emit_event` | string | no | Event topic to emit via `autoloops-ts emit` |
| `emit_payload` | string | no | Payload for the emitted event |

Bundled fixtures in `test/fixtures/backend/`:

| Fixture | Scenario |
|---------|----------|
| `complete-success.json` | Emits `task.complete`, exits 0, includes `LOOP_COMPLETE` |
| `invalid-event.json` | Emits `bogus.not.allowed`, exits 0 |
| `no-completion.json` | No event, no promise, exits 0 |
| `timeout.json` | 30s delay (exceeds typical test timeout) |
| `non-zero-exit.json` | Exits 1 |

## Naming compatibility

The canonical binary and package name is **`autoloops-ts`**. The repository directory is named `autoloop-ts` (without the trailing `s`) for historical reasons.

Environment variables use the `MINILOOPS_` prefix (a legacy name retained for compatibility). Preset configuration files may be named either `autoloops.toml` or `miniloops.toml` — the config loader accepts both.
