# Topology Reference

Topology defines the role structure and routing within a miniloops loop. It is declared in `topology.toml` and controls which roles exist, what events they can emit, and how events route to the next role.

Topology is **advisory** — it is not a hard workflow engine. The model receives routing suggestions and allowed events as context, and backpressure enforces the protocol at the event-emit boundary.

## File format

`topology.toml` lives at the root of a loop's project directory.

```toml
name = "autocode"
completion = "task.complete"

[[role]]
id = "planner"
emits = ["tasks.ready", "task.complete"]
prompt_file = "roles/planner.md"

[[role]]
id = "builder"
emits = ["review.ready", "build.blocked"]
prompt_file = "roles/build.md"

[[role]]
id = "critic"
emits = ["review.passed", "review.rejected"]
prompt_file = "roles/critic.md"

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

## Top-level keys

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `name` | string | No | Human-readable name for the topology. |
| `completion` | string | No | The event that signals loop completion. Falls back to `event_loop.completion_event` in `miniloops.toml`, then to the `completion_promise` text fallback. |

## `[[role]]` — role definitions

Each `[[role]]` table defines one role in the loop. Roles are processed in declaration order.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier for the role. Used in handoff maps and prompt rendering. |
| `emits` | array of strings | Yes | Events this role is allowed to emit. Determines the allowed-event set for backpressure. |
| `prompt` | string | No | Inline prompt text for this role. |
| `prompt_file` | string | No | Path to a markdown file containing the role's prompt, relative to the project directory. |

If both `prompt` and `prompt_file` are set, `prompt` takes precedence. If neither is set, the role has no prompt text.

## `[handoff]` — event routing map

The handoff section maps events to suggested next roles. Each key is an event name and each value is an array of role IDs.

```toml
[handoff]
"loop.start" = ["planner"]
"tasks.ready" = ["builder"]
"review.passed" = ["finalizer"]
```

When an event is emitted, the handoff map is consulted to determine which roles should run next. If the event is not in the handoff map, **all roles** are suggested — the model picks from the full deck.

The special event `"loop.start"` is the initial routing event at the beginning of the loop.

## How routing works

The routing model has three layers:

1. **Suggested roles** — looked up from the handoff map using the most recent event. If the event has no entry, all roles are suggested.
2. **Allowed events** — the union of `emits` arrays from all suggested roles. This is what the model may emit next.
3. **Backpressure** — if the model emits an event not in the allowed set, `miniloops emit` fails immediately and the event is logged as `event.invalid` in the journal. The model is re-prompted with routing context.

This is soft routing: the model sees suggestions and constraints but is not forced into a fixed state machine. The backpressure layer prevents protocol violations without requiring hard-coded transitions.

## Structured parallel routing

When `parallel.enabled = true`, topology still owns the normal routing model, but the harness recognizes two bounded fan-out forms:

- `explore.parallel` — globally available exploratory fan-out
- `<allowed-event>.parallel` — dispatch fan-out for a normal event that is already in the current allowed set

Examples:
- if `tasks.ready` is allowed, the parent may emit `tasks.ready.parallel`
- if `review.ready` is not allowed, `review.ready.parallel` is rejected
- completion events and coordination events do not gain `.parallel` variants in v1

Joined events are harness-owned:
- the model must not emit `*.parallel.joined`
- `explore.parallel.joined` resumes the same routing context that opened the wave
- `<base-event>.parallel.joined` can be routed explicitly in `handoff`

Example explicit join routing:

```toml
[handoff]
"tasks.ready" = ["builder"]
"tasks.ready.parallel.joined" = ["builder"]
```

Parallelism is still structured, not free-form:
- only normal parent turns get the global `Structured parallelism` prompt block
- branch child prompts do **not** get that global metaprompt
- only one active wave may exist at a time
- the parent launches all branches in that wave before joining them
- branch state is isolated under `.miniloop/waves/<wave-id>/...`

## Prompt injection

Each iteration, the topology is rendered into the prompt as advisory context:

```
Topology (advisory):
Recent routing event: tasks.ready
Suggested next roles: builder
Allowed next events: review.ready, build.blocked

Role deck:
- role `planner`
  emits: tasks.ready, task.complete
  prompt: You are the planner.
- role `builder`
  emits: review.ready, build.blocked
  prompt: You are the builder.
...
```

The prompt summary for each role shows the first non-empty line of its prompt text.

## Default topology

If no `topology.toml` exists, the loop runs with an empty topology: no roles, no handoff map, no completion event from topology. The loop still functions — it relies on `miniloops.toml` for the completion event and the model operates without role routing.

## Completion

The loop completes when the completion event is emitted. The completion event is resolved in this order:

1. `completion` field in `topology.toml`
2. `event_loop.completion_event` in `miniloops.toml`
3. The `completion_promise` text fallback (a string the model can output directly)

Additionally, `miniloops.toml` can declare `event_loop.required_events` — events that must appear in the journal before the completion event is accepted.

## Design patterns

### Linear pipeline
Roles hand off in sequence. Each role emits one "success" event that routes to the next role.

```
planner → builder → critic → finalizer
```

### Rejection loops
A reviewing role can reject and route back to the producing role, creating iterative refinement cycles.

```toml
"review.rejected" = ["builder"]   # builder tries again
"fix.failed" = ["fixer"]          # fixer tries again
```

### Fan-back to start
After a cycle completes a unit of work, route back to the first role to pick up the next unit.

```toml
"queue.advance" = ["planner"]     # planner picks next task
"report.updated" = ["scanner"]    # scanner looks for more
```

### Blocked escalation
A role that cannot proceed emits a `.blocked` event, routing to a role that can re-plan or provide context.

```toml
"build.blocked" = ["planner"]
"fix.blocked" = ["diagnoser"]
```

## Examples

Every `auto*` preset in `presets/` includes a `topology.toml`. See:

- `presets/autocode/topology.toml` — 4-role build loop with rejection
- `presets/autospec/topology.toml` — clarify → research → design → task → critique spec loop
- `presets/autodoc/topology.toml` — audit → write → check → publish cycle
- `presets/autoresearch/topology.toml` — hypothesis → implement → measure → evaluate
- `presets/autosec/topology.toml` — scan → analyze → harden → report
- `presets/autofix/topology.toml` — diagnose → fix → verify → close with re-open support
