# Configuration Reference

All runtime configuration lives in `miniloops.toml` at the root of a loop's project directory. Keys use flat dot-notation (`section.key = value`). The legacy `miniloops.conf` format is also accepted — the harness checks for `miniloops.toml` first and falls back to `miniloops.conf`.

Configuration is **hot-reloaded** every iteration. You can change any value mid-run and it takes effect on the next iteration without restarting.

## File format

```toml
# Comments start with #
event_loop.max_iterations = 100
backend.command = "pi"
event_loop.required_events = ["review.passed"]
```

Values can be bare strings, quoted strings, or TOML-style arrays. Arrays are internally stored as CSV and parsed back on read:

```toml
# These are equivalent:
event_loop.required_events = ["review.passed", "tests.ok"]
event_loop.required_events = review.passed,tests.ok
```

Lines without `=` are skipped with a warning. Blank lines and comment lines are ignored.

## Precedence

`miniloops.toml` > `miniloops.conf` > built-in defaults.

The CLI `-b`/`--backend` flag overrides backend settings at runtime (kind, command, args, prompt_mode) without changing the file.

## Keys

### Event loop

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `event_loop.max_iterations` | int | `3` | Maximum iterations before the loop halts. |
| `event_loop.completion_event` | string | `"task.complete"` | Event that signals loop completion. Overridden by the `completion` field in `topology.toml` if present. |
| `event_loop.completion_promise` | string | `"LOOP_COMPLETE"` | Text fallback — if the model outputs this string literally, the loop treats it as completion. Used when the model cannot emit a structured event. |
| `event_loop.required_events` | list | `[]` (empty) | Events that must appear in the journal before the completion event is accepted. Prevents premature completion. |
| `event_loop.prompt` | string | `""` | Inline prompt text for the loop objective. If set, takes precedence over `prompt_file`. |
| `event_loop.prompt_file` | string | `""` | Path to a file containing the loop objective, relative to the project directory. Used when `prompt` is empty. |

Prompt resolution order: CLI prompt override > `event_loop.prompt` > `event_loop.prompt_file`.

### Backend

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `backend.kind` | string | `"pi"` | Backend type. `"pi"` for the Pi adapter (the only supported real adapter). `"command"` for mock/test backends. Auto-detected from `backend.command` if empty or unrecognized. |
| `backend.command` | string | `"pi"` | Executable to invoke. For `kind = "pi"`, this is the Pi binary path. For `kind = "command"`, any executable. |
| `backend.timeout_ms` | int | `300000` | Timeout per backend invocation in milliseconds (default 5 minutes). |
| `backend.args` | list | `[]` | Extra flags appended after the built-in Pi arguments (`-p --mode json --no-session`). Example: `["--model", "anthropic/claude-sonnet-4"]`. |
| `backend.prompt_mode` | string | `"arg"` | How the prompt is passed to the backend. `"arg"` passes it as a command-line argument. `"stdin"` passes it on standard input. |

Kind auto-detection: if `kind` is empty or unrecognized, the harness checks whether `command` is or ends with `pi`. If so, kind is `"pi"`; otherwise `"command"`.

### Review (hyperagent)

The review pass is a separate backend invocation that runs periodically for consolidation and hygiene. Most review keys default to the corresponding backend value if not set, but `review.timeout_ms` defaults to `300000` so large task timeouts do not also make reviews hang for a long time.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `review.enabled` | bool | `true` | Enable the hyperagent review pass. Falsy values: `"false"`, `"0"`, `""`. |
| `review.every_iterations` | int | `0` | Run a review every N iterations. `0` means "use the number of roles in `topology.toml`" — one full role cycle between reviews. |
| `review.command` | string | *backend.command* | Backend executable for reviews. |
| `review.kind` | string | *backend.kind* | Backend type for reviews. |
| `review.args` | list | *backend.args* | Extra flags for the review backend. |
| `review.prompt_mode` | string | *backend.prompt_mode* | Prompt delivery mode for reviews. |
| `review.timeout_ms` | int | `300000` | Timeout for review invocations. Raise it only if you intentionally want long-running reviews. |
| `review.prompt` | string | `""` | Inline review prompt. If set, takes precedence over `prompt_file`. |
| `review.prompt_file` | string | `"hyperagent.md"` | Path to the review prompt file, relative to the project directory. |

Review prompt resolution: `review.prompt` > `review.prompt_file` (defaults to `hyperagent.md`).

### Parallel

Structured parallelism stays intentionally small in v1. These keys enable the `.parallel` event protocol and bound wave execution; branch plans still come from event payloads rather than config.

Supported trigger forms:
- `explore.parallel` — exploratory fan-out that resumes the opening routing context after join
- `<allowed-event>.parallel` — dispatch fan-out for a currently allowed normal event such as `tasks.ready.parallel`

Rules and behavior:
- only the harness may emit `*.parallel.joined`
- normal parent turns get the global `Structured parallelism` prompt block when parallelism is enabled
- branch child prompts do **not** get that global metaprompt
- only one active wave is allowed at a time
- wave artifacts are written under `core.state_dir/waves/<wave-id>/...` (default `.miniloop/waves/<wave-id>/...`)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `parallel.enabled` | bool | `false` | Enable structured parallel trigger validation and the parent-only parallel metaprompt (`explore.parallel` and `<allowed-event>.parallel`). |
| `parallel.max_branches` | int | `3` | Maximum number of branch objectives accepted from one `.parallel` trigger payload. Payloads must be markdown bullet or numbered lists with 1..N distinct items. |
| `parallel.branch_timeout_ms` | int | `180000` | Timeout budget per branch wave in milliseconds. Timed-out waves record `wave.timeout` in the parent journal. |

Example:

```toml
parallel.enabled = true
parallel.max_branches = 3
parallel.branch_timeout_ms = 180000
```

### Memory

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `memory.prompt_budget_chars` | int | `8000` | Maximum characters of materialized memory injected into each iteration's prompt. |

### Harness

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `harness.instructions_file` | string | `"harness.md"` | Path to the harness instructions file, relative to the project directory. This file provides standing instructions injected into every iteration. |

### Core

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `core.state_dir` | string | `".miniloop"` | Directory for runtime state (journal, memory, tools). |
| `core.journal_file` | string | `".miniloop/journal.jsonl"` | Path to the journal file. |
| `core.memory_file` | string | `".miniloop/memory.jsonl"` | Path to the memory file. |
| `core.events_file` | string | — | **Legacy alias** for `core.journal_file`. Still accepted; prefer `journal_file`. |
| `core.run_id_format` | string | `"compact"` | Run ID format: `"compact"` for timestamp-based `run-<base36>-<suffix>`, `"counter"` for sequential `run-1`, `run-2`. |

## Full example

```toml
event_loop.max_iterations = 100
event_loop.completion_event = "task.complete"
event_loop.completion_promise = "LOOP_COMPLETE"
event_loop.required_events = ["review.passed"]

backend.kind = "pi"
backend.command = "pi"
backend.timeout_ms = 300000
# backend.args = ["--model", "anthropic/claude-sonnet-4"]

review.enabled = false
review.timeout_ms = 300000
review.every_iterations = 0

parallel.enabled = false
parallel.max_branches = 3
parallel.branch_timeout_ms = 180000

memory.prompt_budget_chars = 8000
harness.instructions_file = "harness.md"

core.state_dir = ".miniloop"
core.journal_file = ".miniloop/journal.jsonl"
core.memory_file = ".miniloop/memory.jsonl"
```

## Mock backend mode

For deterministic local harness testing only:

```toml
backend.kind = "command"
backend.command = "./examples/mock-backend.sh"
```

Command mode invokes the executable directly and captures stdout. It is not a supported production adapter — use Pi for real loops.

## Preset patterns

All `auto*` presets share the same structure. The only value that typically varies per preset is `event_loop.required_events`, which names the quality-gate event for that workflow:

| Preset | Required event(s) |
|--------|-------------------|
| autocode | `review.passed` |
| autospec | `research.ready`, `design.ready`, `spec.ready` |
| autosimplify | `simplification.verified` |
| autodoc | `doc.checked` |
| autofix | `fix.verified` |
| autoperf | `perf.measured` |
| autoqa | `surfaces.identified` |
| autoresearch | `experiment.measured` |
| autoreview | `review.checked` |
| autosec | `findings.reported` |
| autotest | `tests.passed` |
| autoideas | `analysis.validated` |

See `presets/<preset>/miniloops.toml` for complete files.
