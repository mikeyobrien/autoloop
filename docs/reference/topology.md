# Topology Reference

Topology defines the role structure and routing within an autoloop loop. It is declared in `topology.toml` and controls which roles exist, what events they can emit, and how events route to the next role.

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
| `completion` | string | No | The event that signals loop completion. Falls back to `event_loop.completion_event` in `autoloops.toml`, then to the `completion_promise` text fallback. |

## `[[role]]` — role definitions

Each `[[role]]` table defines one role in the loop. Roles are processed in declaration order.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier for the role. Used in handoff maps and prompt rendering. |
| `emits` | array of strings | Yes | Events this role is allowed to emit. Determines the allowed-event set for backpressure. |
| `prompt` | string | No | Inline prompt text for this role. |
| `prompt_file` | string | No | Path to a markdown file containing the role's prompt, relative to the project directory. |
| `backend_kind` | string | No | Override the loop's `backend.kind` for iterations routed to this role. See [Per-role backend overrides](#per-role-backend-overrides). |
| `backend_command` | string | No | Override `backend.command` for this role's iterations. |
| `backend_args` | array of strings | No | Override `backend.args` entirely (replace, not merge). |
| `backend_prompt_mode` | string | No | Override `backend.prompt_mode` (`"arg"` or `"stdin"`). |
| `backend_timeout_ms` | int | No | Override `backend.timeout_ms` for this role's iterations. |
| `backend_agent` | string | No | Kiro `setSessionMode` agent for this role. **Subordinate to `agents.toml`** when the agent map resolves a non-empty value for the same role. |
| `backend_model` | string | No | Kiro `unstable_setSessionModel` model id for this role. |

If both `prompt` and `prompt_file` are set, `prompt` takes precedence. If neither is set, the role has no prompt text.

All seven `backend_*` fields are optional. When unset, the role inherits the global `backend.*` value from `autoloops.toml`. See [Per-role backend overrides](#per-role-backend-overrides) for resolution order, Kiro session lifecycle, and a worked example.

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
3. **Backpressure** — if the model emits an event not in the allowed set, `autoloop emit` fails immediately and the event is logged as `event.invalid` in the journal. The model is re-prompted with routing context.

This is soft routing: the model sees suggestions and constraints but is not forced into a fixed state machine. The backpressure layer prevents protocol violations without requiring hard-coded transitions.

## Per-role backend overrides

By default every iteration uses the global `backend.*` settings from `autoloops.toml`. The seven optional `backend_*` fields on a `[[role]]` let you route one role to a different backend, command, model, or timeout without changing the rest of the loop. A heavyweight critic can run on a slow, premium model while the planner and builder use a cheaper one; a single role can target the Kiro ACP backend while the rest of the loop runs through Pi.

### Resolution order per iteration

For each iteration, the harness resolves the backend spec by overlaying these layers in order — later wins:

1. **Global `backend.*` config** from `autoloops.toml` (the baseline).
2. **Role `backend_*` fields** from `topology.toml` for the first suggested role of the current routing event. Each defined field overrides the corresponding global value; unset fields fall through.
3. **`agents.toml` overlay** on `backend_agent` only — and only when `resolveRoleAgent(...)` returns a non-empty string. This wins over a role's `backend_agent` for Kiro agent routing; it does not affect any other backend field.

Two other rules:

- **Multiple suggested roles → first in `allowedRoles` wins.** If the handoff map routes one event to several roles, the first role in the list contributes the per-iteration `backend_*` overrides.
- **Zero suggested roles → full global fallback, no agent overlay.** When no role is suggested for the current event, the iteration runs against the global `backend.*` exactly as if no overrides existed.

### Field-by-field overlay semantics

Each `backend_*` field overrides the corresponding global field independently. Unspecified role fields fall through to the global value. Notably, `backend_args` is **replace, not merge** — when a role sets `backend_args`, the global `backend.args` is discarded for that role's iterations.

### Kiro session lifecycle

When the loop uses the Kiro backend, the harness keeps a single live ACP session per `LoopContext`. The session is keyed by a **signature** over `command`, `args`, `cwd`, `trust_all_tools`, `agent`, and `model`. Per iteration:

- **Iteration is non-Kiro and a session is live** → terminate the session, then run via the command/pi backend.
- **Iteration is Kiro and no session exists** → spin up lazily.
- **Iteration is Kiro and the signature matches the live session** → reuse. Only call `setSessionMode` / `unstable_setSessionModel` when the tracked agent / model actually differs.
- **Iteration is Kiro and the signature differs** (any of `command`, `args`, `cwd`, `trust_all_tools`, `agent`, `model` changed) → terminate, then re-init with the new spec.

### Minimal example

A single role pinned to a different Kiro model than the rest of the loop:

```toml
[[role]]
id = "critic"
emits = ["review.passed", "review.rejected"]
prompt_file = "roles/critic.md"
backend_kind = "kiro"
backend_command = "kiro-cli"
backend_model = "anthropic/claude-opus-4"
```

### End-to-end worked example: per-role backends and models

A three-role loop where the planner runs on the global Pi backend, the builder uses Kiro with one model, and the critic uses Kiro with a different model:

```toml
# autoloops.toml
backend.kind = "pi"
backend.command = "pi"
```

```toml
# topology.toml
[[role]]
id = "planner"
emits = ["tasks.ready"]
prompt_file = "roles/planner.md"
# no backend_* — uses the global pi backend

[[role]]
id = "builder"
emits = ["review.ready"]
prompt_file = "roles/builder.md"
backend_kind = "kiro"
backend_command = "kiro-cli"
backend_args = ["acp"]
backend_model = "anthropic/claude-sonnet-4"

[[role]]
id = "critic"
emits = ["review.passed", "review.rejected"]
prompt_file = "roles/critic.md"
backend_kind = "kiro"
backend_command = "kiro-cli"
backend_args = ["acp"]
backend_model = "anthropic/claude-opus-4"
```

Walkthrough of one full cycle:

1. **`loop.start` → planner.** No `backend_*` fields, so `iter.backend` is the global `pi` spec. No Kiro session exists; the iteration runs through the Pi adapter.
2. **`tasks.ready` → builder.** `iter.backend` resolves to `kiro` + `kiro-cli acp` + `claude-sonnet-4`. No live session yet, so the harness lazily inits the Kiro session with the builder signature.
3. **`review.ready` → critic.** `iter.backend` resolves to `kiro` + `kiro-cli acp` + `claude-opus-4`. The model field differs, so the signature differs — the harness terminates the builder session and re-inits a fresh one for the critic.
4. **`review.rejected` → builder.** Routes back to the builder. The signature reverts to the builder spec, so the harness terminates the critic session and re-inits for the builder. (If routing went to a non-Kiro role instead, the harness would simply terminate the live session and run the next iteration via Pi.)

See [Backend configuration](configuration.md#backend) for global defaults; see [`agents.toml` — per-role agent routing](configuration.md#agentstoml--per-role-agent-routing) for the Kiro agent overlay that wins over `backend_agent`.

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
- branch state is isolated under `.autoloop/waves/<wave-id>/...`

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

If no `topology.toml` exists, the loop runs with an empty topology: no roles, no handoff map, no completion event from topology. The loop still functions — it relies on `autoloops.toml` for the completion event and the model operates without role routing.

## Completion

The loop completes when the completion event is emitted. The completion event is resolved in this order:

1. `completion` field in `topology.toml`
2. `event_loop.completion_event` in `autoloops.toml`
3. The `completion_promise` text fallback (a string the model can output directly)

Additionally, `autoloops.toml` can declare `event_loop.required_events` — events that must appear in the journal before the completion event is accepted.

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
