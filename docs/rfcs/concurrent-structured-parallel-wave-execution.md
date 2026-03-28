# Concurrent Structured Parallel Wave Execution

## Summary
Make structured parallel waves truly concurrent. The current `.parallel` protocol, wave artifacts, and docs already present branch fan-out as parallel work, but `src/harness.tn` still executes branches serially by launching one branch and waiting for it to finish before starting the next. This proposal keeps the existing public event/config surface and structured-concurrency boundary, while changing wave execution to launch all branch jobs before joining and adding timing visibility plus regression tests that prove overlap.

Code task: `.agents/tasks/tonic-loops/concurrent-structured-parallel-wave-execution.code-task.md`

## Problem
Miniloops already ships a structured-parallel feature surface:
- `explore.parallel`
- `<base-event>.parallel`
- harness-owned `*.parallel.joined`
- branch artifacts under `.miniloop/waves/<wave-id>/...`
- wave lifecycle events in the parent journal

That contract is documented in `README.md`, `docs/topology.md`, `docs/configuration.md`, `docs/journal.md`, and the earlier RFC `docs/rfcs/structured-parallelism-with-event-suffixes.md`.

But the runtime does not yet honor the core promise. In `src/harness.tn`:
- `execute_parallel_wave_with_objectives/5` hands work to `run_parallel_branches/8`
- `run_parallel_branches/8` runs one branch, waits for it to finish, then recurses to the next branch
- `run_parallel_branch/7` blocks on `iterate/2`

That means wave duration grows roughly with the sum of branch durations rather than the slowest branch. The current implementation preserves branch isolation and the join barrier, but the user-facing behavior is still serial.

## Goals
- Make branches within one wave overlap in wall-clock time.
- Preserve the existing public `.parallel` event protocol and config keys.
- Preserve the current structured-concurrency boundary: one parent loop, one active wave, no nested waves, harness-owned joined event.
- Keep branch execution inspectable via explicit files and journal events.
- Add timing data and regression tests so concurrency is visible and enforced.
- Keep the implementation small and explicit rather than adding orchestration layers.

## Non-goals
- Redesigning the `.parallel` event protocol.
- Adding worker pools, schedulers, queues, or a new workflow DSL.
- Supporting nested waves, branch-to-branch messaging, or long-lived peer loops.
- Collapsing branch state into the parent loop or hiding branch artifacts.
- Distributed or remote branch execution.

## Proposed Design

### Keep the public contract; fix execution underneath it
This is a follow-on correction to the already-approved structured-parallel design, not a replacement. The public surface stays the same:
- `parallel.enabled`, `parallel.max_branches`, `parallel.branch_timeout_ms`
- `explore.parallel`
- `<base-event>.parallel`
- harness-owned `*.parallel.joined`
- `.miniloop/waves/<wave-id>/...` artifact layout

The main behavior change is internal: a wave launches all branch jobs before waiting on the barrier.

### Branch execution model
Each branch should run as an isolated child job, not as an in-process recursive call that blocks the parent from launching siblings.

Minimal shape:
1. Validate the `.parallel` payload exactly as today.
2. Create the wave directory and branch directories exactly as today.
3. Materialize each branch’s inputs (`objective.md` plus any small launch metadata needed for debugging).
4. Launch every branch child job.
5. After all launches succeed, enter a join phase that waits for child completion and aggregates outcomes.
6. Emit the existing joined event only after the barrier resolves.

This keeps the parent as the sole orchestrator while making the branch jobs genuinely concurrent.

### Child-job boundary
The implementation should prefer a narrow child-process boundary over a larger in-process concurrency subsystem.

Desired properties:
- branch work keeps using branch mode
- review stays disabled for branches
- nested waves stay disabled for branches
- branch state remains isolated under its branch directory
- the parent retains sole ownership of wave lifecycle and joined-event emission

If a shell/process workaround is needed because Tonic lacks the right subprocess primitive, record that explicitly in `TONIC_MISSING.md` instead of hiding it.

### Join behavior
The parent wave logic should become:
1. launch all children
2. track child completion/timeout state independently
3. collect results into branch-local artifacts and parent journal events
4. write `join.md`
5. append `wave.join.finish`
6. emit the existing harness-owned joined topic

The barrier remains mandatory. A wave is not complete until every launched branch is terminal: success, failure, or timeout.

### Failure and timeout policy
Do not revert to fail-fast cancellation on the first error. Prefer a full barrier with aggregated outcomes.

Why:
- inspectability is better when the join shows all branch outcomes
- the existing wave model is explicitly about barriered convergence
- parent routing should remain a single, post-join decision point

Per-branch timeout should be enforced from each branch’s own launch time. Timed-out children should be terminated and recorded as `backend_timeout` / `wave.timeout` in the same inspectable way as today.

### Timing visibility
The current implementation computes branch elapsed time but does not project it clearly enough into the public artifacts/journal. The concurrent version should make timing behavior visible.

Add timing data to the places operators already inspect:
- `wave.branch.finish` should include `elapsed_ms`
- `wave.join.start` / `wave.join.finish` should include total wave timing
- `branches/<branch-id>/result.md` should show branch elapsed time
- `waves/<wave-id>/join.md` should summarize branch durations and total wave duration

This gives both humans and tests a stable place to confirm that a wave behaved like parallel work.

### Ordering and determinism
Two different kinds of ordering matter:
- **runtime ordering**: branch finish events should reflect actual completion order
- **artifact ordering**: join summaries should stay stable and easy to diff, typically by branch id / launch order

So the design should preserve deterministic artifact presentation without faking serialized execution semantics.

### Test strategy
Add regression coverage that fails if the runtime silently falls back to serial execution.

Minimum additions:
1. A wall-clock overlap test with two slow branches where total wave runtime stays materially below the serial sum.
2. A barrier test that still preserves joined-event routing and branch artifacts under concurrent launch.
3. Timing-field assertions so `elapsed_ms` stays present in journal/artifact outputs.

Use generous timing thresholds so the test proves overlap without becoming flaky.

## Alternatives Considered

### Rename the feature down to serial staged execution
Rejected.
- The public contract already says “parallel”.
- Docs, tests, prompt injection, and artifact naming already lean on that meaning.
- Downgrading the semantics would keep most of the machinery while removing its main value.

### Add a richer scheduler / worker-pool abstraction
Rejected.
- Too much mechanism for the problem.
- Moves the project away from a small inspectable core.
- The wave barrier model does not need a separate orchestration system.

### In-process concurrency primitives inside the harness
Not preferred.
- Could be harder to keep inspectable and isolated.
- Child-job isolation already matches the current branch artifact model.
- A process boundary is simpler to reason about if the runtime support is adequate.

## Open Questions
- What is the smallest reliable child-run entry point: a private internal subcommand, or a shell-driven re-entry path built from the existing self-command?
- Are `elapsed_ms` fields sufficient, or does the journal also need explicit start/end timestamps for future diagnostics?
- If child launch partially succeeds and one spawn fails mid-wave, should the parent immediately tear down launched siblings or finish joining them before marking the wave failed?

## Implementation Notes
Likely touched areas:
- `src/harness.tn` for concurrent branch launch, join/barrier handling, timeout accounting, and timing fields
- runtime entry/CLI plumbing if a private child-run path is required
- `test/parallel_wave_test.tn` for overlap regressions and timing assertions
- `README.md`, `docs/topology.md`, `docs/configuration.md`, and `docs/journal.md` for updated execution semantics and timing visibility
- `TONIC_MISSING.md` if the implementation must use a stdlib-gap workaround for subprocess control

Related prior design:
- `docs/rfcs/structured-parallelism-with-event-suffixes.md`

Execution artifact:
- `.agents/tasks/tonic-loops/concurrent-structured-parallel-wave-execution.code-task.md`