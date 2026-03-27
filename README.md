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

Miniloops ships a family of 12 `auto*` preset workflows. Each is a self-contained agentic loop with a distinct purpose and topology.

| Preset | What it does | Shape |
|--------|-------------|-------|
| **autocode** | Code implementation — slice, build, review, gate | planner → builder → critic → finalizer |
| **autospec** | Specification — turn a rough idea into an RFC + `.code-task.md` pair | clarifier → researcher → designer → planner → critic |
| **autosimplify** | Post-implementation cleanup — simplify recent changes without changing behavior | scoper → reviewer → simplifier → verifier |
| **autoideas** | Repo survey — scan, deep-dive, validate, report | scanner → analyst → reviewer → synthesizer |
| **autoresearch** | Experiment loop — hypothesize, implement, measure, keep/discard | strategist → implementer → benchmarker → evaluator |
| **autoqa** | Zero-dependency validation — inspect domain, plan checks, execute, report | inspector → planner → executor → reporter |
| **autotest** | Test creation — find coverage gaps, write tests, run, assess | surveyor → writer → runner → assessor |
| **autofix** | Bug repair — diagnose, fix, verify, close | diagnoser → fixer → verifier → closer |
| **autoreview** | Code review — read diff, check issues, suggest fixes, summarize | reader → checker → suggester → summarizer |
| **autodoc** | Documentation — audit gaps, write docs, adversarially verify accuracy, publish | auditor → writer → checker → publisher |
| **autosec** | Security audit — scan vulns, confirm, harden, report | scanner → analyst → hardener → reporter |
| **autoperf** | Performance optimization — profile, optimize, measure, keep/discard | profiler → optimizer → measurer → judge |

**Choosing a preset:** Use `autospec` to turn a rough idea into durable planning artifacts. Use `autocode` for feature work. Use `autosimplify` to clean up recent changes without changing behavior. Use `autoideas` for improvement surveys. Use `autoresearch` for hypothesis-driven experiments. Use `autoqa` to validate with native surfaces. Use `autotest` to write new tests. Use `autofix` for bug reports. Use `autoreview` for PR review. Use `autodoc` for documentation gaps. Use `autosec` for security audits. Use `autoperf` for performance optimization.

Across the `auto*` family, the intended posture is skeptical and fail-closed: checker/judge/verifier/reporter/finalizer roles should challenge claims, require evidence, and reject weak proof instead of rubber-stamping. In autocode specifically, the critic is expected to independently run a manual smoke test that exercises the builder's changed code path whenever the repo exposes a practical manual surface.

See [`docs/auto-workflows.md`](docs/auto-workflows.md) for the full taxonomy, naming guidance, and chooser table.

## Loop Chaining

Chains compose presets into multi-loop sequences. Each step runs as an isolated loop with its own state directory.

### chains.toml

Define reusable named chains:

```toml
[[chain]]
name = "code-and-qa"
steps = ["autocode", "autoqa"]

[[chain]]
name = "code-simplify-qa"
steps = ["autocode", "autosimplify", "autoqa"]

[[chain]]
name = "full-cycle"
steps = ["autocode", "autoqa", "autoresearch", "autocode"]
```

### CLI usage

Run a named chain:

```bash
miniloops chain run code-and-qa .
miniloops chain run code-simplify-qa .
miniloops chain list .
```

Run an ad hoc chain:

```bash
miniloops run . --chain autocode,autoqa,autoresearch
```

### How chains work

- Each step runs its preset in sequence with isolated state in `.miniloops/chains/<chain-run-id>/step-<n>/`
- Handoff artifacts (prior step summaries) and result artifacts are written between steps
- Chain lifecycle is journaled: `chain.start`, `chain.step.start`, `chain.step.finish`, `chain.complete`
- If a step fails (non-completion stop), the chain stops and reports the failure
- Preset resolution: step name → `presets/<name>/` directory

Inspect chain state:

```bash
miniloops inspect chain --format md
```

### Dynamic chain generation

Chains can be generated dynamically at runtime by a meta-level orchestrator. Dynamic chains have:
- **Budget constraints**: max depth, steps, runtime, children, consecutive failures
- **Quality gates**: refuse spawning after repeated failures
- **Lineage tracking**: every dynamic chain records its parent
- **Durable specs**: chain definitions stored as JSON in `.miniloops/chains/specs/`
- **Preset vocabulary**: constrained to known preset names

Configure budgets in `chains.toml`:

```toml
[budget]
max_depth = 5
max_steps = 50
max_runtime_ms = 3600000
max_children = 10
max_consecutive_failures = 3
```

See [`docs/dynamic-chains.md`](docs/dynamic-chains.md) for the full design.

### Chains vs Topology

| Layer | Config | Scope |
|-------|--------|-------|
| **Topology** | `topology.toml` | Intra-loop role routing (planner → builder → critic) |
| **Chains** | `chains.toml` / `--chain` | Inter-loop preset composition (autocode → autoqa) |
| **Dynamic chains** | Runtime specs | Meta-level chain planning, selection, spawning |

These are separate layers. Topology stays focused on roles within one loop; chains compose whole loops together; dynamic chains add budget-bounded meta-orchestration above chains.

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

review.enabled = true
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
- hyperagent review is enabled
- review cadence = number of roles in `topology.toml`
- review uses the same Pi adapter unless overridden
- the harness re-reads runtime files before every task iteration, so edits take effect on the next turn
- the hyperagent may make bounded hygiene edits to runtime-facing loop files (`miniloops.toml`, `topology.toml`, `harness.md`, `hyperagent.md`, `roles/*.md`, `context.md`, `plan.md`, `progress.md`, `docs/*.md`) when that improves the next turn
- the hyperagent may consolidate stale context, resolved detours, and no-longer-relevant notes into `docs/*.md` so active working files stay focused on the current objective
- the hyperagent must not edit app/product source code, tests, manifests, or `.miniloops/` state during review
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

Inspect coordination state (issues, slices, commits from journal):

```bash
miniloops inspect coordination --format md
```

Inspect chain state:

```bash
miniloops inspect chain --format md
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
./bin/miniloops -b claude -p autocode "Add a --verbose flag to the CLI"
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
miniloops run autocode
miniloops run autocode "Add OAuth login"
miniloops run /path/to/project
miniloops inspect scratchpad /path/to/project --format md
```

The launcher is a thin wrapper around:

```bash
tonic run /path/to/this/repo ...
```
