# CLI Reference

The CLI is a thin shell over the autoloop control plane. It launches runs, inspects artifacts, and manages memory and chains — but contains no loop logic itself. See [Platform Architecture](../concepts/platform.md) for how the CLI fits into the broader system.

autoloop exposes all functionality through a single binary with subcommands.

```bash
# Via npm/node
node bin/autoloop <subcommand> [args...]

# Or if installed globally / via npx
autoloop <subcommand> [args...]
```

## Environment

| Variable | Purpose |
|----------|---------|
| `AUTOLOOP_PROJECT_DIR` | Override the project directory for subcommands that default to `.` |
| `AUTOLOOP_STATE_DIR` | State directory — used by the Pi adapter to write stream logs |
| `AUTOLOOP_ITERATION` | Current iteration number — set by the harness during runs |
| `AUTOLOOP_PROMPT` | Override the prompt sent to the backend |
| `AUTOLOOP_PROMPT_PATH` | Fallback prompt file path when `AUTOLOOP_PROMPT` is unset |
| `AUTOLOOP_BIN` | Path to the autoloops binary — used by the Pi adapter for prompt projection |
| `AUTOLOOP_LOG_LEVEL` | Current log level — exported by the harness. One of `debug`, `info`, `warn`, `error`, `none`. |
| `AUTOLOOP_REVIEW_MODE` | Set to `metareview` during review turns — changes the Pi stream log prefix |
| `AUTOLOOP_MEMORY_FILE` | Exported by the harness so agents can locate the memory file |

## Subcommands

### `run`

Start a loop.

```bash
autoloop run <preset-name|preset-dir> [prompt...] [flags]
```

The preset argument is required. It must be one of:
- A bundled preset name (e.g. `autocode`, `autoqa`) — resolved to `presets/<name>/` under the installed package.
- An explicit path to a directory containing `autoloops.toml` (or `autoloops.conf`).
- `.` to run from the current directory.

If the preset argument is missing, the CLI exits with a usage error. If the argument does not resolve to a valid preset directory or bundled preset name, the CLI exits with a resolution error. Unknown arguments are never silently reinterpreted as prompt text.

**Flags:**

| Flag | Description |
|------|-------------|
| `-b <backend>`, `--backend <backend>` | Override the backend. `pi` selects the built-in Pi adapter. `kiro` selects the Kiro ACP backend (persistent session via `kiro-cli acp`). `claude` (or a path ending in `/claude`) adds `-p --dangerously-skip-permissions`. Config-based Claude command backends receive the same injection automatically. Any other value is treated as a shell command. |
| `-p <preset>`, `--preset <preset>` | Resolve a bundled preset name (for example `autocode`) or use an explicit custom preset directory. Useful when you want the prompt to start with path-like text or avoid positional ambiguity. |
| `-v`, `--verbose` | Enable verbose logging. |
| `--chain <steps>` | Run an inline chain instead of a single loop. `steps` is a comma-separated list of preset names (e.g. `autocode,autoqa,autoresearch`). |
| `-- <args>` | Pass extra arguments through to the backend. Everything after `--` is appended to the backend's argument list. Combine with `-b` to override both the command and its flags from the CLI. |

**Examples:**

```bash
autoloop run autocode
autoloop run autocode "Fix the login bug"
autoloop run autocode -b kiro "Fix the login bug"
autoloop run --preset autocode "Fix the login bug"
autoloop run . "Fix the login bug" -b pi
autoloop run . --chain autocode,autoqa "Implement the approved change and validate it"
```

### `emit`

Publish a coordination event to the journal.

```bash
autoloop emit <topic> [payload...]
```

The event is validated against the current iteration's allowed-event set. If the topic is not allowed and is not a built-in coordination topic, the emit is rejected and an `event.invalid` entry is written to the journal. Allowed events are derived from the topology's handoff map for the current role.

**Examples:**

```bash
autoloop emit doc.written "Wrote docs/cli.md covering all subcommands"
autoloop emit task.complete "All documentation gaps addressed"
```

### `inspect`

Read projected artifacts from the journal and state directory.

```bash
autoloop inspect <artifact> [selector] [project-dir] [--format <md|terminal|text|json|csv>]
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
| `topology` | — | `terminal`, `json`, `graph` | Topology structure — roles, emits, handoff map, and validation warnings. `graph` renders an ASCII directed graph of event flow. |

**Metrics output formats:**

The `metrics` artifact produces a per-iteration table with columns: `iteration`, `role`, `event`, `elapsed_s`, `exit_code`, `timed_out`, `outcome`.

- **`md`** — Markdown table followed by a summary line: total iterations, total elapsed seconds, and count of distinct events.
- **`terminal`** — The same markdown table rendered for terminal display with ANSI styling.
- **`csv`** — RFC 4180 CSV with header row. Fields containing commas, quotes, or newlines are double-quoted.
- **`json`** — JSON array of objects. Numeric fields (`iteration`, `elapsed_s`, `exit_code`) are numbers or `null`. `timed_out` is a boolean.

When no metrics data exists, `md` outputs `"No metrics data available."`, `csv` outputs the header row only, and `json` outputs `[]`.

**Examples:**

```bash
autoloop inspect scratchpad                    # defaults to terminal
autoloop inspect scratchpad --format md
autoloop inspect prompt 5                     # defaults to terminal
autoloop inspect prompt 5 --format md
autoloop inspect output 3                     # defaults to text
autoloop inspect journal                      # defaults to json
autoloop inspect memory                       # defaults to terminal
autoloop inspect memory --format md
autoloop inspect coordination                 # defaults to terminal
autoloop inspect chain                        # defaults to terminal
autoloop inspect metrics                      # defaults to terminal
autoloop inspect metrics --format md
autoloop inspect metrics --format csv
autoloop inspect metrics --format json
autoloop inspect metrics run-mn9d3uk0-xi0m --format md
autoloop inspect topology                      # defaults to terminal
autoloop inspect topology --format graph       # ASCII directed graph
autoloop inspect topology --format json        # structured JSON
```

### `memory`

Manage the loop's persistent memory store.

#### `memory list`

Print materialized memory entries with stable IDs.

```bash
autoloop memory list [project-dir]
```

#### `memory status`

Print rendered size, configured budget, and active entry counts.

```bash
autoloop memory status [project-dir]
```

#### `memory find`

Search active memory entries by text, category, key/value, source, or ID.

```bash
autoloop memory find <pattern...>
```

#### `memory add learning`

Add a learning entry.

```bash
autoloop memory add learning <text...>
```

The entry is tagged with `source: "manual"`.

If the new entry pushes rendered memory over `memory.prompt_budget_chars`, the CLI warns that the prompt memory will be truncated.

#### `memory add preference`

Add a categorized preference entry.

```bash
autoloop memory add preference <category> <text...>
```

#### `memory add meta`

Add a metadata entry.

```bash
autoloop memory add meta <key> <value...>
```

#### `memory remove`

Tombstone an entry by ID.

```bash
autoloop memory remove <id> [reason...]
```

If no reason is given, the source is recorded as `"manual"`.

If the target ID is missing or already inactive, the CLI prints a warning instead of appending a no-op tombstone.

### `dashboard`

Start the web dashboard.

```bash
autoloop dashboard [options]
```

Launches an HTTP server serving the autoloop dashboard — a web UI for viewing runs, events, worktrees, and loop state. The dashboard reads from the `.autoloop/` state directory in the resolved project directory.

**Flags:**

| Flag | Description |
|------|-------------|
| `--port, -p <port>` | Port to listen on (default: `4800`) |
| `--host <host>` | Host to bind to (default: `127.0.0.1`) |
| `--project-dir <dir>` | Project directory (default: `.`) |
| `--help, -h` | Show help |

The server handles `SIGINT` and `SIGTERM` for graceful shutdown. If the port is already in use, the process exits with code 1.

**Examples:**

```bash
autoloop dashboard                           # http://127.0.0.1:4800
autoloop dashboard -p 3000                   # custom port
autoloop dashboard --host 0.0.0.0 -p 8080   # bind to all interfaces
autoloop dashboard --project-dir /path/to/project
```

### `chain`

Manage named chains defined in `chains.toml`.

#### `chain list`

List all defined chains and their steps.

```bash
autoloop chain list [project-dir]
```

Output shows each chain name followed by its step sequence (e.g. `code-and-qa: autocode -> autoqa`).

#### `chain run`

Run a named chain.

```bash
autoloop chain run <name> [project-dir] [prompt...]
```

The chain must be defined in `chains.toml`. Each step runs as an isolated loop in `.autoloop/chains/<chain-run-id>/step-<n>/`. When a prompt is provided, it is passed directly to step 1 and also written into each step's `handoff.md` as the chain entry objective. Chains advance on bounded-success stops (`completion_event`, `completion_promise`, or `max_iterations`) and stop only on real failure reasons such as backend errors or timeouts.

### `loops`

Operator surface for listing and inspecting runs. Reads from the run registry (`{projectDir}/.autoloop/registry.jsonl`), which is updated by the harness at lifecycle milestones.

#### `loops`

List active (running) loops.

```bash
autoloop loops
```

Output is a concise table with columns: run ID, status, preset, iteration count, latest event, and last updated timestamp. When no runs are active, prints `No active runs.`.

#### `loops --all`

List all runs (any status), most recent first.

```bash
autoloop loops --all
```

#### `loops show <run-id>`

Show detailed information for a single run.

```bash
autoloop loops show <run-id>
```

Displays: run ID, status, preset, objective, trigger, backend, iteration, latest event, stop reason (if terminal), created/updated timestamps, work directory, and state directory.

Partial run-ID matching is supported: if the given string is a unique prefix of a run ID, that run is shown. If the prefix is ambiguous, all matching run IDs are listed.

#### `loops artifacts <run-id>`

Show artifact file paths for a run.

```bash
autoloop loops artifacts <run-id>
```

Displays paths to the journal file, registry file, state directory, and work directory. Supports the same partial run-ID matching as `loops show`.

#### `loops watch <run-id>`

Watch a run live by polling the registry.

```bash
autoloop loops watch <run-id>
```

Polls the registry every 2 seconds and prints a compact progress line whenever the run's state changes (iteration, event, or status). When a run transitions into the watching or stuck health band for its preset, an advisory line is printed (e.g. `[watch] autosimplify: no progress for 3m — investigate soon`). When the run reaches a terminal status (completed, failed, timed_out, stopped), prints a full detail view and exits.

If the run is already in a terminal state when watch starts, prints the detail view immediately and exits. Supports partial run-ID matching.

Press Ctrl+C to stop watching.

#### `loops health`

Print an exception-focused health summary of all runs.

```bash
autoloop loops health [--verbose]
```

Reads the registry and categorizes runs using preset-aware thresholds (see [Operator Health](../features/operator-health.md) for the full policy table):
- **Active**: currently running and recently updated
- **Watching**: running but quiet longer than the preset's warning threshold — investigate soon
- **Stuck**: running but quiet longer than the preset's stuck threshold — likely needs intervention
- **Failed**: failed or timed out within the last 24 hours
- **Completed**: completed within the last 24 hours (suppressed by default)

When no exceptions exist, prints a one-line "All clear" summary. When exceptions exist (stuck, watching, or failed), prints them grouped by category with a table header. Pass `--verbose` to also list recent completions.

Designed for cron jobs and chat delivery: call this one command and forward the output.

**Examples:**

```bash
autoloop loops                              # active runs
autoloop loops --all                        # all runs
autoloop loops show run-mn9d3uk0-xi0m       # full run ID
autoloop loops show run-mn9d                # partial match
autoloop loops artifacts run-mn9d3uk0-xi0m  # artifact paths
autoloop loops watch run-mn9d3uk0-xi0m      # live watch
autoloop loops health                       # exception summary
autoloop loops health --verbose             # include completions
```

### `worktree`

Manage git worktrees used for run isolation.

```bash
autoloop worktree [subcommand] [args...]
```

Worktrees provide git-level isolation for runs. Each isolated run gets its own worktree branch, and this command surfaces their status, lets you merge results back, and clean up when done. See [Worktree & Isolation](../features/worktree.md) for the full model.

#### `worktree list`

List all tracked worktrees with status, branch, base, merge strategy, and creation time.

```bash
autoloop worktree              # default subcommand
autoloop worktree list
```

Prints `No worktrees found.` when no worktree metadata exists.

#### `worktree show`

Display detailed information for a specific worktree.

```bash
autoloop worktree show <run-id>
```

Shows: run ID, status (with `(orphan)` suffix if the worktree path no longer exists), branch, base branch, merge strategy, worktree path, created/merged/removed timestamps.

#### `worktree merge`

Merge a worktree branch back to the base branch.

```bash
autoloop worktree merge <run-id> [--strategy <squash|merge|rebase>]
```

| Flag | Description |
|------|-------------|
| `--strategy <squash\|merge\|rebase>` | Override the merge strategy recorded in the worktree metadata |

On success, prints a confirmation. On failure, lists conflicting files and prints a recovery hint. Exits with code 1 on merge failure.

#### `worktree clean`

Remove worktree directories and metadata.

```bash
autoloop worktree clean [--all] [--force] [<run-id>]
```

| Flag | Description |
|------|-------------|
| `--all` | Clean all worktrees, including running ones |
| `--force` | Force deletion without prompts |
| `<run-id>` | Target a specific run (optional) |

By default, removes orphaned worktrees (where the worktree path no longer exists on disk) and worktrees in terminal status (`merged`, `failed`, `removed`). Reports the count of cleaned and skipped worktrees.

**Examples:**

```bash
autoloop worktree                                    # list all
autoloop worktree show run-mn9d3uk0-xi0m             # detail view
autoloop worktree merge run-mn9d3uk0-xi0m            # merge with recorded strategy
autoloop worktree merge run-mn9d3uk0-xi0m --strategy squash
autoloop worktree clean                              # clean orphans + terminal
autoloop worktree clean --all                        # clean everything
autoloop worktree clean --force run-mn9d3uk0-xi0m    # force-clean specific run
```

### `pi-adapter`

Run the Pi backend adapter directly. This is normally called by the harness, not by users.

```bash
autoloop pi-adapter [pi-command] [extra-args...]
```

The adapter resolves the prompt from `AUTOLOOP_PROMPT`, then falls back to projecting it via `autoloop inspect prompt`, then falls back to reading `AUTOLOOP_PROMPT_PATH`. It invokes Pi with `-p --mode json --no-session` plus any extra arguments, parses the NDJSON stream, and writes the raw stream to `.autoloop/pi-stream.<iteration>.jsonl` (or `pi-review.<iteration>.jsonl` in review mode).

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
autoloop run . -b "node dist/testing/mock-backend.js" \
  MOCK_FIXTURE_PATH=test/fixtures/backend/complete-success.json

# Or set the env var separately
export MOCK_FIXTURE_PATH=test/fixtures/backend/complete-success.json
autoloop run . -b "node dist/testing/mock-backend.js"
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
| `emit_event` | string | no | Event topic to emit via `autoloop emit` |
| `emit_payload` | string | no | Payload for the emitted event |

Bundled fixtures in `test/fixtures/backend/`:

| Fixture | Scenario |
|---------|----------|
| `complete-success.json` | Emits `task.complete`, exits 0, includes `LOOP_COMPLETE` |
| `invalid-event.json` | Emits `bogus.not.allowed`, exits 0 |
| `no-completion.json` | No event, no promise, exits 0 |
| `timeout.json` | 30s delay (exceeds typical test timeout) |
| `non-zero-exit.json` | Exits 1 |

## Developer Scripts

These npm scripts and tools support day-to-day development on the autoloop codebase.

### `bin/dev` dispatcher

A single entry point for common dev tasks. Run `bin/dev` or `bin/dev --help` to see all subcommands.

```bash
bin/dev <command> [args...]
```

| Command | Delegates to | Description |
|---------|-------------|-------------|
| `build` | `npm run build` | Compile TypeScript via `tsc` |
| `test [args]` | `npm test -- [args]` | Run test suite with Vitest |
| `test:watch` | `npm run test:watch` | Vitest in watch mode |
| `hooks` | `bin/install-hooks` | Install git hooks |
| `run [args]` | `node bin/autoloop [args]` | Run autoloop |

Unknown subcommands print an error and the help text, then exit non-zero.

### npm scripts

| Script | Command | Description |
|--------|---------|-------------|
| `build` | `npm run build` | Compile TypeScript via `tsc`. Also serves as a type-check gate. |
| `test` | `npm test` | Run the full test suite with [Vitest](https://vitest.dev/) (`--experimental-vm-modules` enabled automatically). |
| `test:watch` | `npm run test:watch` | Run Vitest in watch mode for rapid feedback during development. |

### Git hooks

Local git hooks live in `hooks/` and can be installed with:

```bash
bin/install-hooks
```

This creates symlinks from `.git/hooks/` to the project `hooks/` directory. The script is idempotent — safe to re-run at any time.

| Hook | What it runs | Purpose |
|------|-------------|---------|
| `pre-commit` | `npm run build` | Catches type errors before they reach the repo. |
| `pre-push` | `npm test` | Catches test regressions before they reach the remote. |

To bypass hooks in an emergency, use `git commit --no-verify` or `git push --no-verify`.

### Vitest tips

```bash
# Run a single test file
npm test -- test/cli.test.ts

# Run tests matching a pattern
npm test -- -t "chain"

# Run with verbose output
npm test -- --reporter=verbose
```

## Naming compatibility

The canonical binary and package name is **`autoloop`**. The repository directory is named `autoloop-ts` (without the trailing `s`) for historical reasons.

Environment variables use the `AUTOLOOP_` prefix. Preset configuration files may be named either `autoloops.toml` or `miniloops.toml` — the config loader accepts both.
