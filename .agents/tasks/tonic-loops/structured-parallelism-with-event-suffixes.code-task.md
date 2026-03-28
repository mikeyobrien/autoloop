# Task: Add Structured Parallelism With Event Suffixes

## Description
Add a minimal structured parallelism model inside loops using event-name conventions instead of a new workflow config layer. The system should support two bounded fan-out forms:
- `explore.parallel` for exploratory self-loop fan-out that merges back into the same routing context
- `<base-event>.parallel` for dispatch fan-out that launches downstream branch work for the normal handoff of `<base-event>`

The implementation must preserve a hard anti-chaos boundary: one canonical parent loop, at most one active wave, mandatory join, no nested fan-out in v1, and no branch being allowed to continue as an independent live loop after the barrier.

## Background
Miniloops currently has a narrow, inspectable single-lane loop model:
- one routing context at a time
- one backend turn per iteration
- one canonical parent loop
- one append-only journal as runtime truth

That simplicity is good and should be preserved. The goal is not to turn miniloops into a general workflow engine or scheduler. The goal is to introduce one small structured-concurrency primitive that supports useful bounded parallelism without letting loop state explode into uncontrolled peer loops.

The design direction is already settled:
- no `workflow.toml` in v1
- no branch plans authored in config
- branch objectives come from the trigger event payload
- parallelism is exposed through prompt injection plus event suffix conventions
- `explore.parallel` is the exploratory self-loop form
- `<base-event>.parallel` is the dispatch form
- `*.parallel.joined` is harness-owned and resumes the parent loop after the barrier

The crucial product boundary is:
- a wave suspends the parent loop until it resolves
- branch workers are temporary child jobs, not durable peer loops
- the only continuation after a wave is the joined parent continuation

## Reference Documentation
**Required:**
- Design: `AGENTS.md`
- Design: `/Users/rook/AGENTS.md`
- Design: `README.md`
- Design: `docs/topology.md`
- Design: `docs/configuration.md`
- Design: `docs/journal.md`
- Design: `src/config.tn`
- Design: `src/topology.tn`
- Design: `src/harness.tn`
- Design: `src/main.tn`
- Design: `docs/rfcs/structured-parallelism-with-event-suffixes.md`

**Additional References (if relevant to this task):**
- `src/chains.tn` for isolated child-run patterns and durable per-run artifacts
- `src/pi_adapter.tn` for branch-local stream artifact handling
- `examples/autocode/topology.toml`
- `examples/autocode/roles/planner.md`
- `examples/autocode/roles/build.md`
- `examples/autocode/roles/critic.md`
- `docs/hyperagent.md`

**Note:** Keep the implementation visibly bounded. Do not create free-form peer loops, nested waves, or a second orchestration DSL.

## Technical Requirements
1. Add three new minimal runtime config keys in `miniloops.toml`:
   - `parallel.enabled`
   - `parallel.max_branches`
   - `parallel.branch_timeout_ms`
2. Do not add `workflow.toml` or a separate wave config file in v1.
3. Support the special exploratory trigger event `explore.parallel` when parallelism is enabled.
4. Support dispatch trigger events of the form `<base-event>.parallel` when `<base-event>` is already in the current allowed next-event set.
5. Reserve `*.parallel.joined` as harness-owned events that the model may not emit directly.
6. Reject parallelization of coordination events, system events, and whole-loop completion events in v1.
7. Parse branch objectives from the trigger payload using a simple list grammar:
   - markdown bullets
   - numbered lists
8. Validate wave payloads strictly:
   - at least one objective
   - no more than `parallel.max_branches`
   - no empty objectives
   - invalid waves must fail closed and produce inspectable journal output
9. Implement exploratory semantics:
   - `explore.parallel` launches exploratory child branches using the current routing context
   - `explore.parallel.joined` resumes the same routing context snapshot that opened the wave
10. Implement dispatch semantics:
   - `<base-event>.parallel` launches child branches from the normal downstream handoff of `<base-event>`
   - `<base-event>.parallel.joined` resumes the parent loop and should be routable via normal topology handoff
11. Snapshot the opening routing context for wave inspection and exploratory resume:
   - recent event
   - suggested roles
   - allowed events
12. Enforce structured-concurrency invariants in v1:
   - one canonical parent loop
   - at most one active wave
   - parent loop suspended while wave is active
   - branches cannot advance parent routing directly
   - branches cannot open nested waves
   - branches cannot outlive the wave barrier as live peer loops
13. Create isolated branch state under the parent state dir using a visible wave layout such as `.miniloop/waves/<wave-id>/branches/<branch-id>/...`.
14. Ensure each branch produces durable branch-local output/artifacts sufficient for later inspection.
15. Add parent journal events for wave lifecycle, including at minimum:
   - `wave.start`
   - `wave.branch.start`
   - `wave.branch.finish`
   - `wave.join.start`
   - `wave.join.finish`
   - plus invalid/timeout/failure events as needed
16. Add prompt injection when `parallel.enabled = true` that explains:
   - `explore.parallel`
   - `<allowed-event>.parallel`
   - payload format
   - branch count limits
   - joined event behavior
   - anti-overuse guidance
17. Keep role-specific fan-out guidance in role prompts rather than config.
18. Update docs to explain the two fan-out forms, the structured boundary, the event conventions, and the inspectable file/journal layout.
19. Add tests for payload validation, active-wave boundary enforcement, joined-event ownership, exploratory resume behavior, dispatch branch context derivation, and branch artifact creation.
20. Validation should include `tonic check .` and relevant focused tests.

## Dependencies
- Existing runtime config parsing in `src/config.tn`
- Existing topology parsing and routing in `src/topology.tn`
- Existing loop execution, prompt rendering, and journal writing in `src/harness.tn`
- Existing CLI emit and inspect behavior in `src/main.tn`
- Existing isolated child-run and artifact ideas in `src/chains.tn`
- Existing journal-first inspectability model

## Implementation Approach
1. Add the three minimal parallel config keys and keep all other parallel behavior convention-based.
2. Extend emit validation so the parent loop can recognize `explore.parallel` and `<allowed-event>.parallel` as special trigger events.
3. Add list parsing for wave payloads and fail-closed validation for malformed branch plans.
4. Introduce a small wave lifecycle in the harness:
   - detect trigger
   - snapshot opening routing context
   - create a wave directory
   - spawn isolated branch jobs
   - wait for all branches or timeout
   - write join artifact
   - append harness-owned joined event
5. Keep branch jobs constrained. Even if branch execution reuses loop machinery internally, do not let branches publish parent routing events or open nested waves.
6. Implement exploratory join by restoring the opening routing context snapshot and injecting branch results into the resumed parent prompt.
7. Implement dispatch join by deriving branch start context from the normal handoff of the base event, then routing the joined event through ordinary topology handoff in the parent loop.
8. Add a small global parallelism metaprompt block when enabled, gated so it only appears in normal parent turns and not during branch child execution.
9. Update docs and examples to show the intended usage pattern:
   - planner exploratory fan-out then planner merge
   - planner dispatch to parallel builders then builder/critic integration
10. Add focused tests around the anti-chaos invariants so future changes cannot silently turn child branches into peer loops.

## Acceptance Criteria

1. **Minimal Config Surface Exists**
   - Given the implemented feature
   - When a user inspects `docs/configuration.md` and config parsing
   - Then only `parallel.enabled`, `parallel.max_branches`, and `parallel.branch_timeout_ms` are required for v1 parallelism

2. **Exploratory Trigger Works**
   - Given a loop with `parallel.enabled = true`
   - When the model emits `explore.parallel` with a valid branch objective list
   - Then the harness creates one wave, runs the branches, emits `explore.parallel.joined`, and resumes the same routing context snapshot

3. **Dispatch Trigger Works**
   - Given a loop where `tasks.ready` is currently allowed and routes to `builder`
   - When the model emits `tasks.ready.parallel` with valid branch objectives
   - Then the harness launches builder-context branch jobs and later emits `tasks.ready.parallel.joined`

4. **Invalid Dispatch Is Rejected**
   - Given a loop where `review.ready` is not currently allowed
   - When the model emits `review.ready.parallel`
   - Then the harness rejects the wave and records an inspectable invalid-wave/invalid-event result

5. **Malformed Payloads Fail Closed**
   - Given a `.parallel` trigger with empty prose, too many items, or malformed branch entries
   - When the harness validates the payload
   - Then it does not start any branch jobs and records a visible validation failure

6. **One Active Wave At A Time**
   - Given a parent loop with an active wave in progress
   - When another `.parallel` event is attempted before join/timeout/failure resolution
   - Then the second wave is rejected and the parent loop does not multiply into overlapping waves

7. **Parent Loop Suspends During Wave**
   - Given a valid wave has started
   - When the wave is active
   - Then the normal parent loop does not continue ordinary iterations until the wave resolves

8. **Branches Cannot Become Peer Loops**
   - Given multiple branch jobs launched from a dispatch wave
   - When they complete
   - Then they terminate into the barrier and no branch remains as a live parent-equivalent loop after join

9. **Joined Events Are Harness-Owned**
   - Given the model tries to emit `explore.parallel.joined` or `tasks.ready.parallel.joined`
   - When emit validation runs
   - Then the event is rejected because joined events are system-owned

10. **Branch State Is Isolated And Visible**
   - Given a completed wave
   - When a reader inspects `.miniloop/waves/...`
   - Then they can see branch-local durable state and result artifacts for each child branch

11. **Wave Lifecycle Is Journaled**
   - Given a successful or failed wave
   - When a reader inspects the parent journal
   - Then wave start, branch lifecycle, join, and failure/timeout events are present with enough context to understand what happened

12. **Prompt Injection Explains Parallelism**
   - Given `parallel.enabled = true`
   - When a normal parent iteration prompt is rendered
   - Then the prompt includes a concise protocol block explaining exploratory and dispatch fan-out, payload shape, limits, and joined-event behavior

13. **Docs Explain The Boundary Clearly**
   - Given the updated docs and RFC
   - When a contributor reads them
   - Then it is clear that waves are structured-concurrency blocks with a barrier, not open-ended multiplication of loops

14. **Validation Passes**
   - Given the completed implementation
   - When `tonic check .` and relevant focused tests are run
   - Then they pass successfully

## Metadata
- **Complexity**: High
- **Labels**: miniloops, parallelism, structured-concurrency, event-protocol, topology, journal, inspectability, prompting
- **Required Skills**: orchestration design, event schema design, runtime boundary design, Tonic app development, documentation, test design
