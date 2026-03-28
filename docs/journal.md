# Journal Reference

The journal is the canonical runtime source of truth for a miniloops loop. Every significant event — system lifecycle, agent actions, coordination, review, and chain execution — is appended as a single JSON line to `.miniloop/journal.jsonl`. Nothing is mutated or deleted; the file is append-only.

Higher-level views (scratchpad, coordination state, chain progress) are **projections** — derived by reading the journal and filtering/aggregating events.

## File format

The journal is JSONL (one JSON object per line). There are two record shapes: **system events** and **agent events**.

### System events

Emitted by the harness at lifecycle boundaries.

```json
{"run": "run-mn9d3uk0-xi0m", "iteration": "3", "topic": "iteration.start", "fields": {"recent_event": "tasks.ready", "suggested_roles": "builder", "allowed_events": "review.ready,build.blocked", "backpressure": "", "prompt": "..."}}
```

| Field | Type | Description |
|-------|------|-------------|
| `run` | string | Run identifier. Default format is compact: `"run-<base36_timestamp>-<suffix>"` (e.g. `"run-mn9d3uk0-xi0m"`). Set `core.run_id_format = "counter"` for sequential `"run-1"`, `"run-2"`, etc. |
| `iteration` | string | Iteration number. Empty for `loop.start`. |
| `topic` | string | Event type. |
| `fields` | object | Topic-specific payload (varies by event type). |

### Agent events

Emitted by the model via `miniloops emit`.

```json
{"run": "run-mn9d3uk0-xi0m", "iteration": "3", "topic": "review.ready", "payload": "initial implementation complete", "source": "agent"}
```

| Field | Type | Description |
|-------|------|-------------|
| `run` | string | Run identifier. |
| `iteration` | string | Iteration number. |
| `topic` | string | The event name the agent chose to emit. |
| `payload` | string | Free-text summary provided by the agent. |
| `source` | string | Always `"agent"`. |

### Coordination events

Coordination events use the agent event shape (with `payload` and `source: "agent"`) but encode structured data inside the payload using `key=value;` pairs:

```json
{"run": "run-mn9d3uk0-xi0m", "iteration": "2", "topic": "issue.discovered", "payload": "id=issue-1; summary=fix login bug; disposition=open; owner=builder;", "source": "agent"}
```

## Event lifecycle

A loop run produces events in this order:

```
loop.start
  iteration.start          ─┐
  backend.start             │  repeated per
  [agent events]            │  iteration
  backend.finish            │
  iteration.finish         ─┘
  [review.start]           ─┐  optional,
  [review.finish]          ─┘  periodic
  [wave.* events]              optional, during structured parallel fan-out/join
  [event.invalid]              optional, on bad emit
loop.complete   or   loop.stop
```

### Lifecycle events

| Topic | When | Fields |
|-------|------|--------|
| `loop.start` | Once at the beginning of a run. | `max_iterations`, `completion_promise`, `completion_event`, `review_every`, `objective` |
| `iteration.start` | Start of each iteration. | `recent_event`, `suggested_roles`, `allowed_events`, `backpressure`, `prompt` |
| `backend.start` | Before invoking the backend. | `backend_kind`, `command`, `prompt_mode`, `timeout_ms` |
| `backend.finish` | After backend returns. | `exit_code`, `timed_out` (boolean), `output` |
| `iteration.finish` | End of each iteration. | `exit_code`, `timed_out` (boolean), `elapsed_s` (integer seconds), `output` |
| `review.start` | Before a hyperagent review pass. | `kind` (`"hyperagent"`), `backend_kind`, `command`, `prompt_mode`, `prompt`, `timeout_ms` |
| `review.finish` | After review completes. | `kind` (`"hyperagent"`), `exit_code`, `timed_out` (boolean), `output` |
| `loop.complete` | Loop finished successfully. | `reason` (`"completion_event"` or `"completion_promise"`) |
| `loop.stop` | Loop halted without completion. | `reason` (`"max_iterations"`, `"backend_failed"`, or `"backend_timeout"`). The `max_iterations` variant also includes `completed_iterations`, `stopped_before_iteration`, and `max_iterations`. The `backend_failed` and `backend_timeout` variants also include `iteration` and `output_tail`. |

### Agent events (custom)

Agents emit events from the role's `emits` list (defined in `topology.toml`). These are the routing events that drive the handoff map:

```bash
./.miniloop/miniloops emit review.ready "code is ready for review"
./.miniloop/miniloops emit task.complete "all work done"
```

Any event the agent emits is recorded with `source: "agent"` in the journal.

### Coordination events

Coordination events are structured bookkeeping events that bypass backpressure validation — they are always accepted regardless of the allowed-events set. They track issue lifecycles, work slices, and context archival.

| Topic | Payload fields | Description |
|-------|---------------|-------------|
| `issue.discovered` | `id`, `summary`, `disposition`, `owner` | A new issue was found. |
| `issue.resolved` | `id`, `resolution` | An issue was resolved. Updates disposition to `"resolved"`. |
| `slice.started` | `id`, `description` | A unit of work began. Status: `"in-progress"`. |
| `slice.verified` | `id` | A slice passed verification. Status: `"verified"`. |
| `slice.committed` | `id`, `commit_hash` | A slice was committed. Status: `"committed"`. Links the slice to a git commit. |
| `context.archived` | `source_file`, `dest_file`, `reason` | The hyperagent archived stale context from a working file to a docs file. |
| `chain.spawn` | `chain_id`, `parent_id`, `steps`, `justification` | A dynamic sub-chain was spawned from within a running loop. |

Coordination payload fields use `key=value;` encoding inside the `payload` string.

### Wave lifecycle events (structured parallelism)

When `parallel.enabled = true`, the harness records wave events for parallel branch execution. These use the system event shape.

| Topic | Fields | Description |
|-------|--------|-------------|
| `wave.start` | `wave_id`, `trigger_topic`, `branch_count`, `opening_recent_event`, `opening_roles`, `opening_events`, `objectives` | A parallel wave was opened. |
| `wave.branch.start` | `wave_id`, `branch_id`, `objective`, `routing_event`, `branch_roles`, `branch_events` | A branch within a wave began execution. |
| `wave.branch.finish` | `wave_id`, `branch_id`, `stop_reason`, `output` | A branch completed. |
| `wave.join.start` | `wave_id`, `trigger_topic`, `branch_count`, `branch_outcomes` | All branches finished; join phase began. |
| `wave.failed` | `wave_id`, `failed_branches` | One or more branches failed (non-timeout). |
| `wave.timeout` | `wave_id`, `timed_out_branches` | One or more branches exceeded `parallel.branch_timeout_ms`. |
| `wave.invalid` | `trigger_topic`, `reason`, `active_wave_id`, `opening_recent_event` | A `.parallel` trigger was rejected (e.g. wave already active, parallelism disabled). |

### Chain events

Chain events are recorded in the journal when running multi-loop compositions via `miniloops chain run`. They use the system event shape.

| Topic | Fields | Description |
|-------|--------|-------------|
| `chain.start` | `name`, `steps`, `step_count` | Chain execution began. |
| `chain.step.start` | `step`, `preset`, `preset_dir`, `work_dir` | A chain step launched its loop. |
| `chain.step.finish` | `step`, `preset`, `stop_reason` | A chain step completed. |
| `chain.complete` | `name`, `steps_completed`, `outcome` | Chain execution finished. |
| `chain.spawn` | `chain_id`, `parent_id`, `steps`, `justification` | Dynamic sub-chain spawned (also a coordination event). |

### Structured parallel wave events

When structured parallelism is enabled and the parent emits `explore.parallel` or `<allowed-event>.parallel`, the harness appends wave lifecycle events to the **parent** journal.

| Topic | Fields | Description |
|-------|--------|-------------|
| `wave.start` | `wave_id`, `trigger_topic`, `branch_count`, `opening_recent_event`, `opening_roles`, `opening_events`, `objectives` | A new wave opened from the parent routing context. |
| `wave.branch.start` | `wave_id`, `branch_id`, `objective`, `routing_event`, `branch_roles`, `branch_events` | One branch child run started. |
| `wave.branch.finish` | `wave_id`, `branch_id`, `stop_reason`, `elapsed_ms`, `output` | One branch child run finished. |
| `wave.join.start` | `wave_id`, `trigger_topic`, `branch_count`, `elapsed_ms`, `branch_outcomes` | The parent reached the join barrier and is aggregating branch outcomes. |
| `wave.join.finish` | `wave_id`, `trigger_topic`, `joined_topic`, `routing_basis`, `resume_recent_event`, `resume_roles`, `resume_events`, `elapsed_ms` | The harness resolved the barrier and prepared the parent resume context. |
| `wave.timeout` | `wave_id`, `timed_out_branches` | One or more branches exceeded `parallel.branch_timeout_ms`. |
| `wave.failed` | `wave_id`, `failed_branches` | One or more branches ended without a success stop reason. |
| `wave.invalid` | `trigger_topic`, `reason`, `active_wave_id`, `opening_recent_event` | A `.parallel` trigger payload or active-wave rule was invalid. |

Notes:
- only the harness may emit `*.parallel.joined`; those joined events are recorded as normal agent-style journal entries on the parent run after `wave.join.finish`
- the parent launches branch children concurrently, but still waits at the join barrier until every launched branch is terminal
- branch state stays isolated on disk under `core.state_dir/waves/<wave-id>/...` (default `.miniloop/waves/<wave-id>/...`), including `spec.md`, `join.md`, per-branch logs, and per-branch result artifacts
- only one active wave exists at a time in v1

## Backpressure and event validation

Miniloops uses **soft routing with protocol backpressure**. The model receives advisory routing suggestions but is not locked into a state machine. However, the event-emit boundary enforces constraints.

### How validation works

1. The topology's handoff map determines **suggested roles** from the most recent routing event.
2. The **allowed events** are the union of all `emits` arrays from the suggested roles.
3. When the agent emits an event (via `miniloops emit` or detected in backend output), it is checked against the allowed set.
4. **Coordination events bypass validation** — they are always accepted.
5. **If the allowed-events list is empty** (no topology or unmapped event), all events are accepted.

### On invalid emit

When an agent emits a disallowed event, two things happen:

1. An `event.invalid` record is appended to the journal with fields: `recent_event`, `emitted` (what the agent tried), `suggested_roles`, `allowed_events`.
2. The emit command fails (non-zero exit) and prints a diagnostic to stderr: `invalid event 'X'; recent event: 'Y'; suggested roles: ...; allowed next events: ...`

The harness also checks for invalid events after each iteration completes (in case the agent emitted via some other path). If detected, the invalid event is logged and the loop re-prompts the agent with backpressure context injected into the next iteration's prompt.

### Dual validation points

Invalid events are caught at two points:

- **At emit time** — the `miniloops emit` command validates against `MINILOOPS_ALLOWED_EVENTS` environment variable and rejects immediately.
- **After iteration** — the harness scans the iteration's journal entries for the latest agent event and validates it against the topology. This catches events emitted through non-standard paths.

## Completion detection

The loop checks for completion after each valid iteration, in order:

1. **Completion event** — if the completion event (from `topology.toml` or `miniloops.toml`) appears in the run's journal topics **and** all `required_events` have also been seen, the loop completes with `reason: "completion_event"`.
2. **Completion promise** — if the backend output contains the `completion_promise` string literally, the loop completes with `reason: "completion_promise"`.
3. Otherwise, the next iteration begins.

Required events are cumulative across the entire run, not per-iteration.

## Scratchpad projection

The scratchpad is a markdown view projected from `iteration.finish` events. It provides a running summary of what happened each iteration.

The rich inspect format is:

```markdown
## Iteration 1

exit_code=0

<iteration output>

## Iteration 2

exit_code=0

<iteration output>
```

Each section is built from the `exit_code` and `output` fields of the corresponding `iteration.finish` journal entry. The scratchpad has two render targets:

- Iteration prompts and hyperagent review prompts get a compact view that keeps the most recent iterations detailed and collapses older ones to short summaries.
- `miniloops inspect scratchpad --format md` keeps the richer view for debugging.
- Both views are scoped to the current run (filtered by `run` ID).

## Run scoping

All journal operations filter to the current run ID. The run ID is set at `loop.start` and carried through as `MINILOOPS_RUN_ID` in the environment. Multiple runs can coexist in the same journal file — each run's events are isolated by their `run` field.

The latest run is found by scanning backward for the most recent `loop.start` entry.

## Inspecting the journal

The journal and its projections can be inspected via CLI:

```bash
miniloops inspect journal --format json       # raw JSONL
miniloops inspect scratchpad --format md       # iteration summaries
miniloops inspect coordination --format md     # issues, slices, commits, archives
miniloops inspect metrics --format md          # per-iteration metrics table with summary
miniloops inspect metrics --format csv         # metrics as RFC 4180 CSV
miniloops inspect metrics --format json        # metrics as JSON array
miniloops inspect prompt 3 --format md         # iteration 3 prompt
miniloops inspect output 3 --format text       # iteration 3 output
miniloops inspect chain --format md            # chain execution state
```

## JSON encoding

The journal uses Unicode escape sequences for special characters inside string values:

| Character | Encoding |
|-----------|----------|
| `\` | `\u005c` |
| `"` | `\u0022` |
| newline | `\u000a` |
| carriage return | `\u000d` |
| tab | `\u0009` |

This keeps each journal entry on a single line while preserving the full content of prompts and outputs.
