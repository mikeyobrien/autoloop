# CLI Reference

Miniloops exposes all functionality through a single binary with subcommands. The public CLI can come from either a compiled release binary or the source wrapper script.

```bash
# Via a compiled release binary or an installed source wrapper
miniloops <subcommand> [args...]

# Via the source checkout through the Tonic runtime
tonic run <project-dir> <subcommand> [args...]
```

When installed from GitHub Releases, `miniloops` is a standalone compiled binary. In a source checkout, `bin/miniloops` is a thin shell wrapper that calls `tonic run` with the repo root as the project directory and forwards all arguments.

## Environment

| Variable | Purpose |
|----------|---------|
| `MINILOOPS_PROJECT_DIR` | Override the project directory for subcommands that default to `.` |
| `MINILOOPS_STATE_DIR` | State directory — used by the Pi adapter to write stream logs |
| `MINILOOPS_ITERATION` | Current iteration number — set by the harness during runs |
| `MINILOOPS_PROMPT` | Override the prompt sent to the backend |
| `MINILOOPS_PROMPT_PATH` | Fallback prompt file path when `MINILOOPS_PROMPT` is unset |
| `MINILOOPS_BIN` | Path to the miniloops binary — used by the Pi adapter for prompt projection |
| `MINILOOPS_LOG_LEVEL` | Current log level — exported by the harness. One of `debug`, `info`, `warn`, `error`, `none`. |
| `MINILOOPS_REVIEW_MODE` | Set to `hyperagent` during review turns — changes the Pi stream log prefix |
| `MINILOOPS_MEMORY_FILE` | Exported by the harness so agents can locate the memory file |

## Subcommands

### `run`

Start a loop.

```bash
miniloops run <preset-name|preset-dir> [prompt...] [flags]
```

The preset argument is required. It must be one of:
- A bundled preset name (e.g. `autocode`, `autoqa`) — resolved to `examples/<name>/` under the installed project.
- An explicit path to a directory containing `miniloops.toml` (or `miniloops.conf`).
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
miniloops run autocode
miniloops run autocode "Fix the login bug"
miniloops run --preset autocode "Fix the login bug"
miniloops run . "Fix the login bug" -b pi
miniloops run . --chain autocode,autoqa "Implement the approved change and validate it"
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
miniloops inspect <artifact> [selector] [project-dir] [--format <md|terminal|text|json|csv>]
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
miniloops inspect scratchpad                    # defaults to terminal
miniloops inspect scratchpad --format md
miniloops inspect prompt 5                     # defaults to terminal
miniloops inspect prompt 5 --format md
miniloops inspect output 3                     # defaults to text
miniloops inspect journal                      # defaults to json
miniloops inspect memory                       # defaults to terminal
miniloops inspect memory --format md
miniloops inspect coordination                 # defaults to terminal
miniloops inspect chain                        # defaults to terminal
miniloops inspect metrics                      # defaults to terminal
miniloops inspect metrics --format md
miniloops inspect metrics --format csv
miniloops inspect metrics --format json
miniloops inspect metrics run-mn9d3uk0-xi0m --format md
```

### `memory`

Manage the loop's persistent memory store.

#### `memory list`

Print materialized memory entries with stable IDs.

```bash
miniloops memory list [project-dir]
```

#### `memory status`

Print rendered size, configured budget, and active entry counts.

```bash
miniloops memory status [project-dir]
```

#### `memory find`

Search active memory entries by text, category, key/value, source, or ID.

```bash
miniloops memory find <pattern...>
```

#### `memory add learning`

Add a learning entry.

```bash
miniloops memory add learning <text...>
```

The entry is tagged with `source: "manual"`.

If the new entry pushes rendered memory over `memory.prompt_budget_chars`, the CLI warns that the prompt memory will be truncated.

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

If the target ID is missing or already inactive, the CLI prints a warning instead of appending a no-op tombstone.

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
miniloops chain run <name> [project-dir] [prompt...]
```

The chain must be defined in `chains.toml`. Each step runs as an isolated loop in `.miniloop/chains/<chain-run-id>/step-<n>/`. When a prompt is provided, it is passed directly to step 1 and also written into each step's `handoff.md` as the chain entry objective. Chains advance on bounded-success stops (`completion_event`, `completion_promise`, or `max_iterations`) and stop only on real failure reasons such as backend errors or timeouts.

### `pi-adapter`

Run the Pi backend adapter directly. This is normally called by the harness, not by users.

```bash
miniloops pi-adapter [pi-command] [extra-args...]
```

The adapter resolves the prompt from `MINILOOPS_PROMPT`, then falls back to projecting it via `miniloops inspect prompt`, then falls back to reading `MINILOOPS_PROMPT_PATH`. It invokes Pi with `-p --mode json --no-session` plus any extra arguments, parses the NDJSON stream, and writes the raw stream to `.miniloop/pi-stream.<iteration>.jsonl` (or `pi-review.<iteration>.jsonl` in review mode).

## `bin/miniloops` launcher

The `bin/miniloops` shell script is a convenience wrapper:

```bash
#!/bin/sh
tonic run "$REPO_DIR" "$@"
```

It resolves the repository root from its own location, runs `tonic run` with that directory as the project, and forwards all remaining arguments. It traps `INT`/`TERM` to clean up the child process.

## Testing

### `bin/test`

Run the test suite.

```bash
bin/test                        # run all tests in test/
bin/test test/config_test.tn    # run a single test file
bin/test --filter "parse"       # run tests matching a pattern
```

When the first argument is an existing `.tn` file, it is used as the test target instead of the default `test/` directory. All other arguments are passed through to `tonic test`.

**Flags:**

| Flag | Description |
|------|-------------|
| `--filter <pattern>` | Run only tests matching pattern |
| `--list` | List available tests without running |
| `--format json` | Output results as JSON |
| `--fail-fast` | Stop on first failure (default) |
| `--timeout <ms>` | Per-test timeout in milliseconds (default: 20000) |
| `--verbose` | Verbose output |

### `bin/test-watch`

Re-run tests automatically on file changes. Requires [`entr`](https://eradman.com/entrproject/) (soft dependency).

```bash
bin/test-watch                       # watch and re-run all tests
bin/test-watch test/config_test.tn   # watch and re-run a single file
```

If `entr` is not installed, the script prints install instructions and exits. All arguments are forwarded to `bin/test`.

## Developer Scripts

All developer scripts are accessible through the `bin/dev` dispatcher or individually.

```bash
bin/dev              # list available commands
bin/dev <command>    # run a command
```

### `bin/dev` commands

| Command | Script | Purpose | Exit codes |
|---------|--------|---------|------------|
| `test [args]` | `bin/test` | Run the test suite | 0 = pass, 1 = failure |
| `watch [args]` | `bin/test-watch` | Watch mode for tests | 1 = `entr` not installed |
| `smoke` | `scripts/pi-smoke.sh` | Pi backend integration smoke test | 0 = pass, 1 = failure |
| `judge` | `scripts/llm-judge.sh` | LLM judge evaluation | 0 = pass, 1 = failure |
| `run [args]` | `bin/miniloops` | Start a miniloops run | See subcommand docs |
| `hooks` | `bin/install-hooks` | Install git hooks | 0 = success, 1 = error |
| `check-missing` | `bin/check-missing` | Lint for unannotated workarounds | 0 = clean, 1 = warnings |

Additional release scripts live under `scripts/` and are used by `.github/workflows/release.yml`.

### `scripts/pi-smoke.sh`

End-to-end Pi backend smoke test. Creates a temporary miniloops project, runs one Pi-backed iteration, and asserts that the loop completes correctly with expected journal entries.

### `scripts/llm-judge.sh`

LLM judge evaluation harness. Runs evaluation prompts through the backend and scores the outputs.

### `bin/install-hooks`

Symlinks `hooks/pre-commit` and `hooks/pre-push` into `.git/hooks/`. Idempotent — safe to re-run.

### `bin/check-missing`

Scans `.tn` files for shell-out workaround patterns and cross-references them against `# TONIC_MISSING:` annotations and `TONIC_MISSING.md` entries. Warns on unannotated workarounds.

### `scripts/build-release.sh`

Compiles a standalone `miniloops` binary with `tonic compile` to the output path you pass in.

```bash
scripts/build-release.sh dist/miniloops
```

### `scripts/package-release.sh`

Packages a compiled binary into a deterministic release archive.

```bash
scripts/package-release.sh dist/miniloops v0.1.0 linux-x64 dist
```

### `scripts/install-tonic.sh`

Installs the Tonic compiler used by CI and release workflows. It prefers the pinned git commit in `.tonic-git-ref` and falls back to `.tonic-version` when the bridge is removed.

```bash
scripts/install-tonic.sh
```

### `scripts/release-smoke.sh`

Smoke-tests a compiled `miniloops` binary with the real run-path check used for release validation.

```bash
scripts/release-smoke.sh dist/miniloops
```
