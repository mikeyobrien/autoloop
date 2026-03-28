# Structured Parallelism With Event Suffixes

## Summary
Add a minimal, structured parallelism model inside loops using event-name conventions rather than a new workflow config layer. When parallelism is enabled, the harness exposes two bounded fan-out forms:

- `explore.parallel` for exploratory self-loop fan-out that merges back into the same routing context
- `<base-event>.parallel` for dispatch fan-out that starts branches from the normal downstream handoff of `<base-event>`

Both forms use strict structured-concurrency boundaries: the parent loop suspends while one active wave runs, branches are temporary child jobs rather than peer loops, and only the harness may emit `*.parallel.joined` to resume the parent loop.

Code task: `.agents/tasks/tonic-loops/structured-parallelism-with-event-suffixes.code-task.md`

## Problem
Today loops are strictly single-lane:
- one routing context per iteration
- one backend turn per iteration
- one scratchpad projection
- one parent loop lifecycle

That keeps the runtime simple, but it prevents useful bounded parallel work such as:
- planners comparing multiple decompositions before committing
- planners dispatching independent implementation slices to multiple builders
- critics running parallel review lenses before converging

The danger is obvious: naive parallelism turns one inspectable loop into a swarm of semi-independent loops. That would violate the repo's design tenets around simplicity, inspectability, journal-first runtime truth, and visible boundaries.

The missing abstraction is:

> a structured parallel wave with a barrier, not free-form multiplication of live loops.

## Goals
- Add useful bounded parallelism within a loop without introducing a new orchestration file format
- Preserve one canonical parent loop and avoid branch soup
- Let prompts and role judgment decide when to fan out, rather than encoding branch plans in config
- Support both exploratory fan-out and dispatch fan-out
- Keep the mechanism inspectable via journal events and durable branch artifacts
- Keep the core narrow: one wave at a time, mandatory join, no nested fan-out in v1

## Non-goals
This proposal does not:
- add a DAG/workflow language
- add `workflow.toml`
- create long-lived peer loops inside one run
- support nested waves in v1
- support branch-to-branch messaging in v1
- allow branches to advance parent routing directly
- allow branches to emit `*.parallel.joined`
- allow arbitrary shared mutable branch state
- solve generalized distributed scheduling

## Proposed Design

### Core model
When `parallel.enabled = true`, the harness exposes a global parallelism capability through prompt injection and event semantics.

There are two forms.

#### 1. Exploratory fan-out
`explore.parallel`

Meaning:
- the current role/routing context wants bounded parallel investigation before committing to a normal handoff
- branches inherit the current routing context in exploratory mode
- after all branches complete, the harness emits `explore.parallel.joined`
- the parent loop resumes the same routing context with branch results injected

Use this when the model needs more evidence before choosing the real next event.

#### 2. Dispatch fan-out
`<base-event>.parallel`

Meaning:
- `<base-event>` is a normal loop event that is already allowed in the current routing context
- the model is committing to parallel downstream work for the normal handoff of `<base-event>`
- branches start from the downstream routing context of `<base-event>`
- after all branches complete, the harness emits `<base-event>.parallel.joined`
- the parent loop resumes in an integration role/context chosen by topology for the joined event

Example:
- planner emits `tasks.ready.parallel`
- normal topology says `tasks.ready -> builder`
- the harness creates multiple builder-style branches
- topology may route `tasks.ready.parallel.joined -> builder` for integration or `-> critic` for adjudication

### Minimal config surface
Keep the runtime config intentionally small.

`miniloops.toml`:

```toml
parallel.enabled = true
parallel.max_branches = 3
parallel.branch_timeout_ms = 180000
```

No `workflow.toml`. No per-wave config in v1.

### Event conventions
Parallel behavior is recognized by event suffixes.

- exploratory trigger: `explore.parallel`
- dispatch trigger: `<base-event>.parallel`
- exploratory joined event: `explore.parallel.joined`
- dispatch joined event: `<base-event>.parallel.joined`

Rules:
- `explore.parallel` is available globally when parallelism is enabled
- `<base-event>.parallel` is valid only when `<base-event>` is already in the allowed next-event set
- `*.parallel.joined` is harness-owned and may not be emitted by the model
- coordination events and completion events do not gain parallel forms in v1

### Payload contract
Parallel trigger payloads are the branch plan. The model decides branch content at runtime.

Accepted input shape in v1:
- markdown bullet list
- numbered list

Each list item becomes one branch objective.

Validation:
- minimum 1 branch objective
- maximum `parallel.max_branches`
- empty items are rejected
- invalid payload rejects the wave and records a wave validation event in the journal

This keeps branch planning prompt-first and avoids a new config schema.

### Structured concurrency boundary
This is the most important part of the proposal.

#### Invariants
1. Only one canonical parent loop exists.
2. At most one active wave exists in v1.
3. Opening a wave suspends normal parent iteration until the wave resolves.
4. Branches are temporary child jobs, not peer loops.
5. Branches may not advance parent routing directly.
6. Branches may not open nested waves in v1.
7. Only the harness may emit `*.parallel.joined`.
8. Every wave resolves through a barrier: joined, timeout, failed, or cancelled.

These invariants are the anti-chaos boundary.

### Branch execution model
Branches may reuse loop machinery internally, but semantically they are branch jobs.

Each branch gets:
- a branch-local state directory under the parent state dir
- one branch objective
- the parent objective and relevant context snapshot
- a timeout from `parallel.branch_timeout_ms`
- isolated journal / scratchpad / stream artifacts

In v1 branches must not:
- publish parent loop events
- spawn chains
- open more waves
- claim whole-task completion

Branches should produce:
- branch result artifact
- exit status / timeout status
- journaled branch lifecycle entries

### Routing semantics
#### Exploratory join
`explore.parallel.joined` resumes the same routing context that opened the wave.

In practice that means restoring the opening routing context snapshot:
- recent event
- suggested roles
- allowed events

The next parent prompt includes branch results and asks the model to choose the real next event.

#### Dispatch join
`<base-event>.parallel.joined` should normally be routed explicitly in `topology.toml`.

Examples:

```toml
[handoff]
"tasks.ready" = ["builder"]
"tasks.ready.parallel.joined" = ["builder"]
```

or

```toml
[handoff]
"tasks.ready.parallel.joined" = ["critic"]
```

This keeps integration ownership explicit.

### Prompt injection
When `parallel.enabled = true`, inject a short global metaprompt into normal parent iterations.

It should explain:
- `explore.parallel` is available for exploratory self-loop fan-out
- `<allowed-event>.parallel` is available for dispatch fan-out
- payload format is a list of 1..N branch objectives
- branches must be distinct, concrete, and independently useful
- one active wave at a time
- branches run in isolated state
- joined events are harness-owned

Role prompts may further tune when and how a role should use exploratory or dispatch fan-out.

### File layout
Keep branch state under the existing state root.

Example:

```text
.miniloop/
  journal.jsonl
  memory.jsonl
  waves/
    wave-1/
      spec.md
      join.md
      branches/
        branch-1/
          journal.jsonl
          result.md
        branch-2/
          journal.jsonl
          result.md
```

The exact artifact filenames may stay simple in v1, but the layout must make the wave boundary visible from disk.

### Journal model
Add wave lifecycle events to the parent journal:
- `wave.start`
- `wave.branch.start`
- `wave.branch.finish`
- `wave.join.start`
- `wave.join.finish`
- `wave.timeout` / `wave.failed` / `wave.invalid` as needed

These events should record enough context to inspect:
- trigger event
- branch count
- opening routing context snapshot
- branch objectives
- branch outcomes
- joined event emitted by the harness

## UX / File Layout / CLI

### Author-facing behavior
No new top-level config file is required.

Normal topology continues to declare ordinary events. Parallelism becomes an event modifier plus one special exploratory event.

Example prompt-driven usage:

```bash
./.miniloop/miniloops emit explore.parallel "
- Compare two different decompositions of the task and recommend one.
- Identify the highest-risk unknown that should be validated before coding.
- Find the smallest slice that would prove the design.
"
```

Dispatch example:

```bash
./.miniloop/miniloops emit tasks.ready.parallel "
- Parse `.parallel` events and validate payload shape.
- Inject the global parallelism metaprompt when enabled.
- Add wave journal events and inspect rendering.
"
```

### Topology example
```toml
name = "autocode"
completion = "task.complete"

[[role]]
id = "planner"
emits = ["tasks.ready", "explore.parallel", "task.complete"]
prompt_file = "roles/planner.md"

[[role]]
id = "builder"
emits = ["review.ready", "build.blocked"]
prompt_file = "roles/build.md"

[[role]]
id = "critic"
emits = ["review.passed", "review.rejected"]
prompt_file = "roles/critic.md"

[handoff]
"loop.start" = ["planner"]
"explore.parallel.joined" = ["planner"]
"tasks.ready" = ["builder"]
"tasks.ready.parallel.joined" = ["builder"]
"review.ready" = ["critic"]
```

## Alternatives Considered

### Dedicated `workflow.toml`
Rejected for v1 because it adds another orchestration layer and parser before the minimal behavior is proven useful.

### Parallel triggers declared in config
Rejected for v1 because it duplicates truth and pushes branch planning into config instead of prompts.

### Allow any branch to continue as a live peer loop
Rejected because it destroys the single-parent-loop boundary and creates the exact chaos this design is trying to prevent.

### Auto-emit the base event after dispatch join
Rejected because integration often needs a real parent role decision after the branch results are visible.

## Open Questions
- Whether branch mode should internally reuse full loop semantics or run as a more restricted child-job harness in v1
- Whether joined events should always require explicit topology routing for dispatch, or whether a small default should exist when omitted
- How much branch result structure should be standardized beyond markdown result artifacts
- Whether hyperagent review should be deferred automatically while a wave is active

## Implementation Notes
Likely touched areas:
- `src/config.tn` for minimal parallel settings
- `src/topology.tn` for recognizing `explore.parallel` / `*.parallel.joined` patterns where needed
- `src/harness.tn` for parallel prompt injection, wave lifecycle, branch execution, and join behavior
- `src/main.tn` / emit validation paths for parallel event parsing and branch objective extraction
- `docs/topology.md`, `docs/configuration.md`, `docs/journal.md`, and `README.md`
- tests covering payload validation, structured boundary invariants, joined routing, and wave lifecycle

Execution artifact:
- `.agents/tasks/tonic-loops/structured-parallelism-with-event-suffixes.code-task.md`
