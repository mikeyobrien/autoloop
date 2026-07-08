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
| `backend_provider` | string | No | Override the ACP `backend.provider` preset for this role (`kiro`, `claude-agent-acp`, `generic`, or a custom label). |
| `backend_command` | string | No | Override `backend.command` for this role's iterations. |
| `backend_args` | array of strings | No | Override `backend.args` entirely (replace, not merge). |
| `backend_prompt_mode` | string | No | Override `backend.prompt_mode` (`"arg"`, `"stdin"`, or `"acp"`). |
| `backend_timeout_ms` | int | No | Override `backend.timeout_ms` for this role's iterations. |
| `backend_agent` | string | No | ACP `setSessionMode` agent/mode for this role. **Subordinate to `agents.toml`** when the agent map resolves a non-empty value for the same role. |
| `backend_model` | string | No | ACP `unstable_setSessionModel` model id for this role. |
| `backend_profile` | string | No | Hermes agent profile (`--profile <name> acp`) for this role. Only effective when `backend_provider = "hermes"`. |
| `disallowed_tools` | array of strings | No | Tool names this role is forbidden from using (ralph-parity permission model). Consulted by the `event_loop.audit_file_mods` emit-boundary audit: a role with a non-empty list that modifies files during its iteration is flagged with `policy.file_modification_violation`. |
| `read_only` | bool | No | Declares this role as read-only (no file mutation expected). Consulted by `event_loop.audit_file_mods` alongside `disallowed_tools`. |

If both `prompt` and `prompt_file` are set, `prompt` takes precedence. If neither is set, the role has no prompt text.

All nine `backend_*` fields are optional. When unset, the role inherits the global `backend.*` value from `autoloops.toml`. See [Per-role backend overrides](#per-role-backend-overrides) for resolution order, ACP session lifecycle, and a worked example.

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

By default every iteration uses the global `backend.*` settings from `autoloops.toml`. The optional `backend_*` fields on a `[[role]]` let you route one role to a different backend provider, command, model, or timeout without changing the rest of the loop. A heavyweight critic can run on a slow, premium model while the planner and builder use a cheaper one; a single role can target an ACP provider such as Kiro or Claude Agent ACP while the rest of the loop runs through Pi.

### Resolution order per iteration

For each iteration, the harness resolves the backend spec by overlaying these layers in order — later wins:

1. **Global `backend.*` config** from `autoloops.toml` (the baseline).
2. **Role `backend_*` fields** from `topology.toml` for the first suggested role of the current routing event. Each defined field overrides the corresponding global value; unset fields fall through.
3. **`agents.toml` overlay** on `backend_agent` only — and only when `resolveRoleAgent(...)` returns a non-empty string. This wins over a role's `backend_agent` for ACP agent/mode routing; it does not affect any other backend field.

Two other rules:

- **Multiple suggested roles → first in `allowedRoles` wins.** If the handoff map routes one event to several roles, the first role in the list contributes the per-iteration `backend_*` overrides.
- **Zero suggested roles → full global fallback, no agent overlay.** When no role is suggested for the current event, the iteration runs against the global `backend.*` exactly as if no overrides existed.

### Field-by-field overlay semantics

Each `backend_*` field overrides the corresponding global field independently. Unspecified role fields fall through to the global value. Notably, `backend_args` is **replace, not merge** — when a role sets `backend_args`, the global `backend.args` is discarded for that role's iterations.

### ACP session lifecycle

When the loop uses an ACP backend, the harness starts a fresh stdio ACP session for each iteration. Per iteration:

- **Iteration is non-ACP and a session is live** → terminate the session, then run via the command/pi backend.
- **Iteration is ACP** → initialize the provider command, create a new session, apply supported `agent` / `model` settings, send the prompt, then terminate the session after the turn.
- **Role/provider settings differ between iterations** → no special reuse logic is needed; each iteration already gets an isolated provider session.

### Minimal example

A single role pinned to a different ACP model than the rest of the loop:

```toml
[[role]]
id = "critic"
emits = ["review.passed", "review.rejected"]
prompt_file = "roles/critic.md"
backend_kind = "acp"
backend_provider = "kiro"
backend_command = "kiro-cli"
backend_args = ["acp"]
backend_model = "anthropic/claude-opus-4"
```

### End-to-end worked example: per-role backends and models

A three-role loop where the planner runs on the global Pi backend, the builder uses Kiro ACP with one model, and the critic uses Claude Agent ACP with a different model:

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
backend_kind = "acp"
backend_provider = "kiro"
backend_command = "kiro-cli"
backend_args = ["acp"]
backend_model = "anthropic/claude-sonnet-4"

[[role]]
id = "critic"
emits = ["review.passed", "review.rejected"]
prompt_file = "roles/critic.md"
backend_kind = "acp"
backend_provider = "claude-agent-acp"
backend_command = "npx"
backend_args = ["-y", "@agentclientprotocol/claude-agent-acp"]
backend_model = "anthropic/claude-opus-4"
```

Walkthrough of one full cycle:

1. **`loop.start` → planner.** No `backend_*` fields, so `iter.backend` is the global `pi` spec. No ACP session exists; the iteration runs through the Pi adapter.
2. **`tasks.ready` → builder.** `iter.backend` resolves to `acp:kiro` + `kiro-cli acp` + `claude-sonnet-4`. The harness creates a fresh Kiro ACP session for the builder turn.
3. **`review.ready` → critic.** `iter.backend` resolves to `acp:claude-agent-acp` + `npx -y @agentclientprotocol/claude-agent-acp` + `claude-opus-4`. The harness terminates the builder session and creates a fresh Claude Agent ACP session for the critic.
4. **`review.rejected` → builder.** Routes back to the builder. The harness creates a new Kiro ACP session for the builder, so critic context cannot bleed into the retry. (If routing went to a non-ACP role instead, the harness would simply run the next iteration via Pi.)

See [Backend configuration](configuration.md#backend) for global defaults; see [`agents.toml` — per-role ACP agent routing](configuration.md#agentstoml--per-role-acp-agent-routing) for the ACP agent overlay that wins over `backend_agent`.

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

## Evidence gates

Routing (`[handoff]`) only checks *which* event was emitted, not whether it is
*earned*. An evidence gate makes a success event require machine-checkable
evidence in its payload — otherwise the emit is rejected and a typed `.blocked`
event is journaled instead, so the loop must supply proof before it can advance.

Gates are opt-in, declared as array-of-tables in `topology.toml`:

```toml
[[gate]]
event = "verify.passed"           # the success event to guard
requires = ["tests", "coverage"]  # evidence keys the payload must carry
blocked = "verify.blocked"        # optional; defaults to <prefix>.blocked
```

When a role emits `verify.passed`, its payload must carry every required key as
a structured `key=value` token (or a JSON object) with a non-empty value.
Free-text `key: value` prose does **not** count — that would let an agent satisfy
the gate just by mentioning the words, so machine-checkable `key=value` (or JSON)
is required:

```bash
# rejected -> emits verify.blocked with missing_evidence="coverage"
autoloop emit verify.passed "tests=42 passed"

# rejected -> prose is not machine-checkable evidence
autoloop emit verify.passed "tests: all good, coverage: looks fine"

# accepted
autoloop emit verify.passed "tests=42 passed coverage=87%"
autoloop emit verify.passed '{"tests": 42, "coverage": "87%"}'
```

The `blocked` event flows through `[handoff]` like any other, so you can route
it back to a role that can supply the missing evidence:

```toml
"verify.blocked" = ["builder"]
```

### Typed evidence

`requires` is presence-only: it just checks the key carries *some*
machine-checkable value. Typed evidence goes further — it validates the value
against a schema (test/lint/typecheck pass-status, coverage/mutation numeric
thresholds), and gates can route a failed check to a *different* event than a
missing one. Declare it as an `evidence` array of inline tables on the gate:

```toml
[[gate]]
event = "review.passed"
blocked = "review.evidence.blocked"   # evidence never supplied -> soft retry
failed = "review.rejected"            # evidence supplied but failed -> hard stop
evidence = [
  { key = "tests", type = "test" },
  { key = "lint", type = "lint" },
  { key = "typecheck", type = "typecheck" },
  { key = "coverage", type = "coverage", min = 80 },
]
```

Five evidence types are supported:

| `type`       | validated as                                              | payload example |
|--------------|------------------------------------------------------------|------------------|
| `test`       | presence, plus pass/fail status if a status word is present | `tests=42 passed` / `{"tests": {"value": "42", "status": "passed"}}` |
| `lint`       | same as `test`                                              | `lint=clean passed` / `{"lint": {"value": "0 issues", "status": "passed"}}` |
| `typecheck`  | same as `test`                                              | `typecheck=0 errors passed` |
| `coverage`   | presence, plus numeric `min`/`max` bounds if a number is present | `coverage=87%` / `{"coverage": 87}`, with `min = 80` |
| `mutation`   | same as `coverage`                                          | `mutation=62` / `{"mutation": 62}`, with `min = 50` |
| `generic` (default, or `requires`) | presence only                                | any `key=value` |

For `test`/`lint`/`typecheck`, the status word (one of `passed`, `failed`,
`passing`, `failing`) is optional in the payload — if present, it must match
`status` (default `"passed"`); if you don't emit a status word at all, presence
alone satisfies the rule. For `coverage`/`mutation`, `min`/`max` are inclusive
bounds checked only when a numeric value can be parsed from the payload (a
trailing `%` is stripped automatically).

**`.blocked` vs `.failed`**: a gate's typed evidence check classifies every
shortfall as either `"missing"` (the key was never supplied at all) or
`"threshold"`/`"status"` (the key was supplied but did not clear the bar). Any
`"missing"` shortfall always routes to `blocked` — soft retry, since the same
role can simply supply the evidence next time. A `"threshold"`/`"status"`
shortfall routes to `failed` if configured — hard stop, since evidence that
was actually measured and failed usually means the underlying work needs
fixing, not just re-reporting — falling back to `blocked` if `failed` is
omitted. If a gate mixes missing and failed evidence in one payload, `blocked`
wins (get the missing evidence first).

Worked example — `presets/autocode/topology.toml` gates the critic's
`review.passed`:

```toml
[[gate]]
event = "review.passed"
blocked = "review.evidence.blocked"
failed = "review.rejected"
evidence = [
  { key = "tests", type = "test" },
  { key = "lint", type = "lint" },
  { key = "typecheck", type = "typecheck" },
  { key = "coverage", type = "coverage", min = 80 },
]

[handoff]
"review.evidence.blocked" = ["critic"]  # missing evidence: critic re-checks and re-reports
"review.rejected" = ["builder"]         # evidence failed: back to the role that can fix it
```

`presets/autofix/topology.toml` mirrors this on the verifier's `fix.verified`,
reusing the existing `fix.failed -> fixer` route as the hard-stop target:

```toml
[[gate]]
event = "fix.verified"
blocked = "fix.verify.blocked"
failed = "fix.failed"
evidence = [
  { key = "tests", type = "test" },
  { key = "coverage", type = "coverage", min = 80 },
]
```

The journaled `blocked`/`failed` event carries `gated_event`,
`missing_evidence` (keys with reason `"missing"`), `evidence_type` (the
distinct types touched), `required_evidence` (every declared evidence key),
`threshold_failure` (present only when a `"threshold"`/`"status"` shortfall
occurred, as `key:detail` pairs), and `summary` (the original payload) — so
both an observer and the next iteration's prompt see exactly what evidence is
still needed.

## Examples

Every `auto*` preset in `presets/` includes a `topology.toml`. See:

- `presets/autocode/topology.toml` — 4-role build loop with rejection, plus a
  typed evidence gate on `review.passed` (test/lint/typecheck/coverage)
- `presets/autospec/topology.toml` — clarify → research → design → task → critique spec loop
- `presets/autodoc/topology.toml` — audit → write → check → publish cycle
- `presets/autoresearch/topology.toml` — hypothesis → implement → measure → evaluate
- `presets/autosec/topology.toml` — scan → analyze → harden → report
- `presets/autofix/topology.toml` — diagnose → fix → verify → close with
  re-open support, plus a typed evidence gate on `fix.verified` (test/coverage)
