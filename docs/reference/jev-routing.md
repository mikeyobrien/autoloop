# Jev workflow routing

Jev routing selects a named workflow, such as a playbook, from a preset-owned
catalog. The harness adds that workflow's instructions to the backend prompt.
A route may also override topology handoff targets for the run, which is how a
preset lets Jev choose which role (and so which model) handles an event. It
does not replace completion gates.

Routing is **off by default**. When enabled, it is **fail-closed**: missing
credentials, invalid configuration, provider failures, timeouts, malformed answers,
`no_match`, and confidence below the configured threshold stop the run before the
backend starts, unless the preset names a `fallback_route` (see Lane selection).
There is no fallback to another model, no retry loop, and no shadow mode.

## Configure a preset

Add to `autoloops.toml` (or a single-file preset):

```toml
[routing.jev]
enabled = true
routes_file = "routes.json"
model = "jev-1.13.0"
min_confidence = 0.8
timeout_ms = 2000
```

`routes_file` is relative to the preset directory, not the working repository.
The file is a JSON array of 1–64 routes:

```json
[
  {
    "id": "bug-fix",
    "description": "Repair incorrect behavior in an existing feature",
    "instructions": "Use the bug-fix playbook. Reproduce the defect, fix its cause, then verify the real output."
  },
  {
    "id": "feature",
    "description": "Add a capability that does not currently exist",
    "instructions": "Use the feature playbook. Define the data shape, implement it, and verify the real behavior."
  }
]
```

IDs must be unique, start with a lowercase letter, and contain only lowercase
letters, digits, underscores, or hyphens (64 characters maximum). `no_match` is
reserved. Descriptions and instructions must be nonempty. Keep instructions
self-contained or name absolute paths the backend can read. Align existing role
prompts with the selected workflow; remove competing instructions to select a
playbook independently.

Set `TYPESAFE_API_KEY` in the **harness process** environment through your secret
manager. Do not put a key in TOML, the route catalog, or a command-line argument.
If a protected egress proxy supplies the credential, configure Node's proxy support
for that environment (for example, `--use-env-proxy` on supported Node releases).
A protected key available to OpenClaw is not automatically available to a separate
Autoloop process or host.

| Key | Default | Constraint |
| --- | --- | --- |
| `enabled` | `false` | Explicit boolean; disabled routing does not read the catalog or require credentials |
| `routes_file` | none | Required when enabled |
| `model` | `jev-1.13.0` | Nonempty TypeSafe model ID; pin a version for reproducible evaluation |
| `min_confidence` | `0.8` | Finite number from 0 to 1; tune on your own labeled tasks |
| `timeout_ms` | `2000` | Integer from 1 to 60000; covers request and response body |
| `fallback_route` | none | Route ID selected on `no_match` or low confidence instead of stopping |
| `complexity_route` | none | Route ID selected when the complexity score reaches the threshold; enables the complexity question |
| `complexity_threshold` | `1.5` | Number from 0 to 2; used only with `complexity_route` |

## Lane selection

A route may carry a `handoff` object. When the route is selected, each entry
replaces that event's targets in the run's `[handoff]` table:

```json
{
  "id": "bugfix",
  "description": "Existing behavior is wrong and must be fixed",
  "instructions": "Planner: emit `plan.ready`. Builder: reproduce first.",
  "handoff": { "plan.ready": ["builder-sol"] }
}
```

Targets must be role IDs in the preset topology; an unknown role fails at load.
The patch is reapplied from the cached decision on every iteration and resume.

Routes named by `fallback_route` or `complexity_route` are selected by code and
are not offered to Jev. With `complexity_route`, the same request asks a Score
question over three fixed levels (local change, several connected changes,
cross-cutting or unclear design), scored 0 to 2. Selection order:

1. Complexity score at or above `complexity_threshold` selects `complexity_route`.
2. A confident Choice selects that route.
3. `no_match` or low confidence selects `fallback_route`, or stops the run if none is set.

The `routing.jev.selected` record adds `route` and `reason` (`choice`,
`complexity`, or `fallback`). The `autorigor` preset uses this to pick its
builder lane.

The threshold and deadline are initial configuration defaults, not measured
accuracy or latency guarantees. Choice confidence summarizes the option
distribution; it is not proof that the workflow is correct.

## Runtime behavior

Before building an iteration prompt, the harness sends the objective and candidate
descriptions to `https://api.typesafe.ai/v1/systemone`. Catalog instructions are
not sent to the provider. Jev returns one Choice with probabilities, confidence,
model ID, and usage. The harness validates the response and injects only the
selected **local** instructions, after any `pre_iteration` prompt mutation.

The serialized objective/configuration is limited to 64,000 UTF-8 bytes; oversized
state is rejected, not silently truncated. The endpoint is fixed, redirects are
rejected, and provider error bodies are not logged. Run cancellation aborts an
in-flight request.

The `routing.jev.selected` journal record contains a state hash, elapsed time,
and a `response` JSON string containing only validated model/decision/usage fields.
It is telemetry, not a topology event. The record does not contain the API key,
objective, or route instructions.

Subsequent iterations and resumed runs reuse the validated decision for the same
run ID, objective, configuration, and router contract version. A changed objective
or configuration triggers a fresh decision. A cached response that fails validation stops the run;
it is not silently replaced. A valid cached decision does not require another
API request or the key. Turning routing off explicitly restores the normal harness
path; it is never turned off automatically on error.

This is a workflow-selection layer, not a security boundary. Preset authors still
own trusted instructions and permissions, and ordinary verification must establish
whether the work is correct. Review what objective text may be sent to the hosted
provider before enabling it for a project.

## Verification

```sh
npm run build
npx vitest run packages/harness/test/harness/jev-routing.test.ts \
  packages/harness/test/harness/iteration.test.ts \
  packages/harness/test/harness/config-helpers.test.ts
npm run check
```

Tests cover opt-in isolation, route validation, transport errors, confidence/no-match
rejection, cancellation, journal replay and invalidation, and delivery to the real
iteration boundary with a fixture backend. No production model or run is launched.

TypeSafe contracts: [HTTP API](https://docs.typesafe.ai/api),
[confidence](https://docs.typesafe.ai/confidence), and
[Jev limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).
The adapter uses native `fetch` to retain Autoloop's Node 18 runtime baseline;
the current official TypeSafe JavaScript SDK requires Node 20.
