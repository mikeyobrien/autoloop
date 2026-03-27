# miniloops

A miniloops harness implemented as a Tonic app.

The default preset is an autocode-style loop:
- planner
- builder
- critic
- finalizer

Pi is the first-class backend. Miniloops now runs Pi itself with `pi -p --mode json --no-session`, parses Pi's NDJSON stream internally, and stores the raw stream under `.miniloops/` for debugging.

`examples/mock-backend.sh` remains only as a local mock backend for deterministic harness debugging.

## Workflow family

Miniloops ships a family of `auto*` preset workflows. Each is a self-contained agentic loop with a distinct purpose and topology.

| Preset | What it does | Shape |
|--------|-------------|-------|
| **autocode** | Code implementation — slice, build, review, gate | planner → builder → critic → finalizer |
| **autoideas** | Repo survey — scan, deep-dive, validate, report | scanner → analyst → reviewer → synthesizer |
| **autoresearch** | Experiment loop — hypothesize, implement, measure, keep/discard | strategist → implementer → benchmarker → evaluator |
| **autoqa** | Zero-dependency validation — inspect domain, plan checks, execute, report | inspector → planner → executor → reporter |

**Choosing a preset:** Use `autocode` for feature work and implementation tasks. Use `autoideas` when you want a survey of what to improve. Use `autoresearch` for hypothesis-driven experiments with measurable outcomes. Use `autoqa` to validate a repo using its native build/lint/type-check surfaces without installing anything.

Six more presets are documented as future-facing: `autotest`, `autofix`, `autoreview`, `autodoc`, `autosec`, `autoperf`. See [`docs/auto-workflows.md`](docs/auto-workflows.md) for the full taxonomy, naming guidance, and chooser table.

## Runtime files

- `miniloops.toml` — preferred runtime config
- `miniloops.conf` — legacy fallback
- `topology.toml` — shared loop topology
- `roles/*.md` — role instructions
- `harness.md` — live harness instructions
- `hyperagent.md` — live review instructions
- `.miniloops/journal.jsonl` — append-only runtime journal
- `.miniloops/memory.jsonl` — append-only loop memory
- `.miniloops/pi-stream.<iteration>.jsonl` — raw Pi NDJSON for task turns
- `.miniloops/pi-review.<iteration>.jsonl` — raw Pi NDJSON for hyperagent reviews

## Runtime config

Edit `miniloops.toml`:

```toml
event_loop.max_iterations = 100
event_loop.completion_event = "task.complete"
event_loop.completion_promise = "LOOP_COMPLETE"
event_loop.required_events = ["review.passed"]
# event_loop.prompt = "Write a tiny checklist"
# event_loop.prompt_file = "prompt.txt"

backend.kind = "pi"
backend.command = "pi"
backend.timeout_ms = 300000
# backend.args = ["--model", "anthropic/claude-sonnet-4"]

review.enabled = false
review.timeout_ms = 300000
# review.every_iterations = 0

memory.prompt_budget_chars = 1600
harness.instructions_file = "harness.md"

core.state_dir = ".miniloops"
core.journal_file = ".miniloops/journal.jsonl"
core.memory_file = ".miniloops/memory.jsonl"
```

Notes:
- Pi is the documented default and only supported real adapter.
- `backend.command` defaults to `pi`; override it only if you need a different Pi binary path.
- `backend.args` are extra Pi flags appended after the built-in `-p --mode json --no-session` arguments.
- Review uses the same Pi adapter settings by default.
- `review.every_iterations = 0` means “use the number of roles in `topology.toml`”.
- `event_loop.completion_event` is the real completion signal; `completion_promise` is a text fallback.
- `miniloops.conf` is still accepted for older projects.

### Mock backend mode

For deterministic local harness debugging only:

```toml
backend.kind = "command"
backend.command = "./examples/mock-backend.sh"
```

Command mode is kept for local mock testing. It is not a supported real adapter path.

## Regression check

Run the end-to-end Pi smoke check:

```bash
./scripts/pi-smoke.sh
```

It creates a temp miniloops project, runs a one-iteration Pi-backed loop, and fails unless all of these hold:
- the loop completes via `task.complete`
- the journal records `backend.start`, `backend.finish`, and `loop.complete`
- the projected iteration output is exactly `hello`
- the raw Pi NDJSON log is written to `.miniloops/pi-stream.1.jsonl`

## Topology

Edit `topology.toml`:

```toml
name = "autocode"
completion = "task.complete"

[[role]]
id = "planner"
emits = ["tasks.ready", "task.complete"]
prompt_file = "roles/plan.md"

[[role]]
id = "builder"
emits = ["review.ready", "build.blocked"]
prompt_file = "roles/build.md"

[[role]]
id = "critic"
emits = ["review.passed", "review.rejected"]
prompt_file = "roles/verify.md"

[[role]]
id = "finalizer"
emits = ["queue.advance", "finalization.failed", "task.complete"]
prompt_file = "roles/finalizer.md"

[handoff]
"loop.start" = ["planner"]
"queue.advance" = ["planner"]
"build.blocked" = ["planner"]
"tasks.ready" = ["builder"]
"review.ready" = ["critic"]
"review.rejected" = ["builder"]
"review.passed" = ["finalizer"]
"finalization.failed" = ["builder"]
```

Important:
- topology is advisory, not a hard workflow engine
- `handoff` maps the latest event to suggested next roles
- allowed next events are derived from those roles' `emits`
- the loop completes when the completion event is emitted

## Journal-first runtime model

Miniloops treats the JSONL journal as the runtime source of truth.

That means:
- `loop.start`, `iteration.start`, `backend.start`, agent events, `event.invalid`, `backend.finish`, `review.start`, `review.finish`, `iteration.finish`, and `loop.complete` all land in `.miniloops/journal.jsonl`
- prompt text is stored in the `iteration.start` record
- parsed backend output is stored in the `iteration.finish` record
- raw Pi NDJSON is written separately to `.miniloops/pi-stream.*.jsonl` and `.miniloops/pi-review.*.jsonl`
- scratchpad is projected from completed iterations

Loop memory is separate and append-only:
- `.miniloops/memory.jsonl`
- stores learnings, preferences, and meta notes
- is injected back into future prompts

## Hyperagent review loop

Miniloops can run a meta-level review pass every `review.every_iterations` task iterations.

By default:
- review cadence = number of roles in `topology.toml`
- review uses the same Pi adapter unless overridden
- the harness re-reads runtime files before every task iteration, so edits take effect on the next turn
- the hyperagent may consolidate stale context, resolved detours, and no-longer-relevant notes into `docs/*.md` so active working files stay focused on the current objective
- short durable lessons still belong in loop memory; archived markdown context belongs in `docs/`

## Backpressure on hallucinated events

Miniloops uses soft routing + protocol backpressure:
- topology suggests next roles from the latest routing event
- allowed next events are derived from those roles
- if the model emits an event outside that set, `miniloops emit ...` fails immediately
- the loop records `event.invalid` and prompts again with the recent routing event, suggested roles, and allowed events

## Event tool

During a loop run, miniloops creates a helper command inside `.miniloops/` and tells the agent to use it.

Important shape:

```bash
"$MINILOOPS_BIN" emit <topic> "payload"
```

Examples:

```bash
"$MINILOOPS_BIN" emit review.ready "implemented and verified"
"$MINILOOPS_BIN" emit task.complete "all done"
```

The topic must be in the current allowed next-event set or the emit will be rejected.

Manual usage:

```bash
miniloops emit task.complete "manual completion"
```

From the repo root without installing the shim:

```bash
tonic run . emit task.complete "manual completion"
```

Loop memory commands:

```bash
miniloops memory list
miniloops memory add learning "The verify role should summarize test failures"
miniloops memory add preference Workflow "Keep role prompts short and explicit"
miniloops memory remove mem-3 "stale"
```

## Projections

Inspect the latest scratchpad:

```bash
miniloops inspect scratchpad --format md
```

Inspect memory:

```bash
miniloops inspect memory --format md
miniloops inspect memory --format json
```

Inspect a specific iteration prompt:

```bash
miniloops inspect prompt 1 --format md
```

Inspect a specific iteration output:

```bash
miniloops inspect output 1 --format text
```

Inspect the raw journal:

```bash
miniloops inspect journal --format json
```

Against another project directory:

```bash
miniloops inspect scratchpad /path/to/project --format md
miniloops inspect memory /path/to/project --format md
miniloops inspect prompt 2 /path/to/project --format md
miniloops inspect output 2 /path/to/project --format text
```

## Run

Supported runtime path:

```bash
tonic check .
tonic run .
```

Optional prompt override:

```bash
tonic run . "Write a tiny checklist"
```

Run against another project directory:

```bash
tonic run . /path/to/your/miniloops-project
tonic run . /path/to/your/miniloops-project "Write a tiny checklist"
```

### One-shot backend override

For temporary command-mode experiments, you can override the configured backend at launch time:

```bash
./bin/miniloops -b claude examples/autocode "Add a --verbose flag to the CLI"
```

Notes:
- `-b pi` keeps the built-in Pi adapter path.
- `-b claude` runs Claude in command mode as `claude -p ...`.
- other `-b <command>` values run that command directly in command mode.
- this does not rewrite `miniloops.toml`; it is a one-run override.

## Install `miniloops` as a command

Use the launcher script:

```bash
chmod +x bin/miniloops
mkdir -p ~/.local/bin
ln -sf "$(pwd)/bin/miniloops" ~/.local/bin/miniloops
```

Then:

```bash
miniloops run
miniloops run /path/to/project
miniloops inspect scratchpad /path/to/project --format md
```

The launcher is a thin wrapper around:

```bash
tonic run /path/to/this/repo ...
```
