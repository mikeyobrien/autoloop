# Task: Implement Concurrent Structured Parallel Wave Execution

## Description
Make structured parallel waves truly concurrent. The current `.parallel` feature surface already exists, but the runtime still executes branches serially by running one branch to completion before starting the next. Update the harness so a wave launches all branch jobs before joining, while preserving the current public event/config surface, branch isolation model, and harness-owned joined-event semantics.

## Background
Autoloops already documents structured parallelism as a real fan-out/fan-in primitive:
- `explore.parallel`
- `<base-event>.parallel`
- harness-owned `*.parallel.joined`
- one active wave at a time
- isolated branch state under `.autoloop/waves/<wave-id>/...`

That contract is described in `README.md`, `docs/topology.md`, `docs/configuration.md`, `docs/journal.md`, and the prior RFC `docs/rfcs/structured-parallelism-with-event-suffixes.md`.

The current runtime path in `src/harness.tn` does not match that contract:
- `execute_parallel_wave_with_objectives/5` calls `run_parallel_branches/8`
- `run_parallel_branches/8` launches one branch, waits for `run_parallel_branch/7`, then recurses
- `run_parallel_branch/7` blocks on `iterate/2`

So wave duration grows with the sum of branch durations rather than the slowest branch. This follow-on task is about fixing that mismatch without redesigning the feature surface.

## Reference Documentation
**Required:**
- Design: `AGENTS.md`
- Design: `/Users/rook/AGENTS.md`
- Design: `README.md`
- Design: `docs/topology.md`
- Design: `docs/configuration.md`
- Design: `docs/journal.md`
- Design: `docs/rfcs/structured-parallelism-with-event-suffixes.md`
- Design: `docs/rfcs/concurrent-structured-parallel-wave-execution.md`
- Design: `src/harness.tn`
- Design: `test/parallel_wave_test.tn`

**Additional References (if relevant to this task):**
- `.autoloop/chains/chain-mnahjswo-9nvh/step-1/.autoloop/ideas-report.md`
- `src/config.tn`
- `src/main.tn`
- `src/chains.tn`
- `TONIC_MISSING.md`

**Note:** Keep the implementation narrow. Fix execution so “parallel” means parallel; do not add schedulers, worker registries, or a second orchestration layer.

## Technical Requirements
1. Replace the current serial branch loop in `src/harness.tn` with real concurrent wave execution.
2. Preserve the existing public structured-parallel surface:
   - `parallel.enabled`
   - `parallel.max_branches`
   - `parallel.branch_timeout_ms`
   - `explore.parallel`
   - `<base-event>.parallel`
   - harness-owned `*.parallel.joined`
3. Preserve the current structured-concurrency invariants:
   - one canonical parent loop
   - at most one active wave
   - parent loop suspended until the wave resolves
   - branches cannot advance parent routing directly
   - branches cannot open nested waves
   - only the harness emits joined events
4. Launch all branch jobs before waiting on join.
5. Keep branch execution isolated under `.autoloop/waves/<wave-id>/branches/<branch-id>/...`.
6. Keep branch mode behavior intact: review disabled, nested parallel disabled, branch-local state only.
7. Treat branches as child jobs rather than a new long-lived peer-loop concept.
8. Enforce per-branch timeout from each branch’s launch time, not from the time prior siblings finished.
9. Preserve the barrier: the joined event may fire only after every launched branch is terminal (success, failure, or timeout).
10. Prefer aggregating all branch outcomes over fail-fast cancellation so join artifacts remain inspectable.
11. Make timing visible in inspectable surfaces:
    - add `elapsed_ms` to `wave.branch.finish`
    - add total timing to `wave.join.start` and/or `wave.join.finish`
    - include branch elapsed time in `branches/<branch-id>/result.md`
    - include per-branch and total timing in `waves/<wave-id>/join.md`
12. Keep runtime ordering honest: branch finish events should reflect actual completion, not forced serial order.
13. Keep summary artifacts deterministic and easy to diff, preferably by stable branch id / launch order.
14. Add regression coverage that fails when waves behave like serialized execution.
15. Add focused coverage for timeout/failure behavior under concurrent launch, not just serial semantics.
16. Update docs so they describe real concurrent execution and the new timing visibility.
17. If the implementation uses a shell/process workaround because Tonic lacks a native subprocess primitive, record that gap explicitly in `TONIC_MISSING.md`.
18. Keep the implementation small and inspectable; avoid introducing queues, schedulers, pools, registries, or plugin-style abstractions.

## Dependencies
- Existing wave lifecycle and routing code in `src/harness.tn`
- Existing branch-mode runtime overrides in `src/harness.tn`
- Existing process invocation helpers in `src/harness.tn`
- Existing config/docs for structured parallelism
- Existing branch artifact layout and journal-first inspect model
- Existing `test/parallel_wave_test.tn` fixture harness

## Implementation Approach
1. Extract the current inline branch execution path into a child-job launch path that can run multiple branches concurrently while preserving branch isolation.
2. Keep the parent as the only wave orchestrator: validate payload, create wave directories, launch children, join children, write join artifacts, emit joined event.
3. Launch all branches first, then wait/collect results.
4. Track each branch’s deadline from launch time and mark timed-out branches explicitly.
5. Preserve branch-local artifacts and add timing fields to the existing journal/artifact surfaces instead of inventing new opaque state.
6. Keep branch finish event ordering tied to real completion, while rendering join summaries in a stable branch-id order.
7. Add a deterministic overlap regression using two intentionally slow branches and a generous wall-clock bound that distinguishes concurrency from serial execution.
8. Update docs and tests together so the runtime contract and regression suite stay aligned.
9. If a stdlib gap forces a workaround, record it in `TONIC_MISSING.md` as part of the same change.

## Acceptance Criteria

1. **Waves Launch Branches Concurrently**
   - Given a wave with two slow branches
   - When the wave runs
   - Then total wall-clock duration is materially closer to the slowest branch than to the sum of both branches

2. **Public Parallel Protocol Stays Stable**
   - Given the completed change
   - When docs/config/runtime are inspected
   - Then `.parallel` trigger names, joined-event naming, and parallel config keys are unchanged

3. **Parent Barrier Still Holds**
   - Given a wave in progress
   - When branch children are running
   - Then the parent loop does not continue normal iterations until join resolution

4. **Branch Isolation Still Holds**
   - Given a concurrent wave
   - When branch children run
   - Then each branch stays under its own branch directory with branch-local artifacts and cannot directly advance parent routing

5. **Per-Branch Timeout Uses Launch Time**
   - Given multiple concurrently launched branches
   - When one branch exceeds `parallel.branch_timeout_ms`
   - Then that branch is marked timed out based on its own launch deadline rather than sibling completion order

6. **Joined Event Remains Harness-Owned**
   - Given the completed implementation
   - When a wave resolves
   - Then only the harness appends the joined topic after the join barrier

7. **Failures And Timeouts Remain Inspectable**
   - Given a concurrent wave with failed or timed-out branches
   - When the parent journal and wave artifacts are inspected
   - Then they show branch outcomes clearly enough to debug the wave after the fact

8. **Timing Is Visible In Journal And Artifacts**
   - Given a completed wave
   - When `wave.branch.finish`, `wave.join.*`, branch result files, and `join.md` are inspected
   - Then elapsed timing is present and understandable

9. **Regression Tests Catch Serial Fallback**
   - Given the updated parallel-wave test suite
   - When branch execution silently regresses to serial behavior
   - Then at least one overlap-focused test fails

10. **Docs Match Runtime Reality**
    - Given the updated docs
    - When a contributor reads the structured-parallel sections
    - Then they describe actual concurrent wave execution rather than implied concurrency layered over serial behavior

11. **Implementation Stays Small And Explicit**
    - Given the final diff
    - When reviewed against repo tenets
    - Then it uses explicit child-job launch/join behavior and inspectable files rather than new scheduling abstractions

12. **Validation Passes**
    - Given the completed change
    - When `tonic check .` and relevant focused parallel-wave checks are run
    - Then they pass successfully

## Metadata
- **Complexity**: High
- **Labels**: autoloops, parallelism, concurrency, structured-concurrency, harness, journal, inspectability, performance
- **Required Skills**: runtime design, subprocess orchestration, Tonic app development, test design, documentation