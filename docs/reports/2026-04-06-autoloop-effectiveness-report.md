# Autoloop Effectiveness Report

_Date: 2026-04-06_

## Executive summary

Current autoloops in `autoloop-ts` are **meaningfully effective, but not yet consistently disciplined**.

The strongest evidence is operational:

- `autoloop loops --all` shows **16/16 recent runs completed**.
- `autoloop loops health --verbose` reports **all clear** with no stuck or failed runs.
- Recent runs are producing **real repo artifacts and merged code**, not just transient chatter:
  - `d891f25` — `MINILOOPS_*` → `AUTOLOOP_*` rename across runtime/tests/docs
  - `f60834b`, `795ea2c`, `fa73a0b` — dashboard API + UI progress
  - `e0fe746`, `b8e0130`, `b3f9526`, `6c96b67`, `75c75b8` — preset-aware supervision policy and health surfaces

That said, the journals also show a consistent quality tax:

- **18 invalid emits across 16 runs**
- **8/16 runs finished via `completion_promise` instead of the intended completion event**
- shared-state carryover and stale working-file context still appear in metareview artifacts
- `autospec` is the weakest preset operationally: longest runs, highest invalid-emit rate, heaviest supervision needs

## Evidence reviewed

### Runtime evidence

- `.autoloop/registry.jsonl`
- `.autoloop/journal.jsonl`
- `.autoloop/progress.md`
- `.autoloop/ideas-report.md`

### Control-plane views

- `node bin/autoloop loops --all`
- `node bin/autoloop loops health --verbose`
- `node bin/autoloop loops show <run-id>` for all current recent runs

### Repo outcomes

- recent `git log` / changed-file history on `main`
- current committed artifacts in `docs/`, `src/`, `test/`, and `.agents/tasks/`

## Quantitative snapshot

### Overall

- Total recent runs reviewed: **16**
- Completed: **16/16**
- Failed/stuck/timed out currently visible: **0**
- Median iterations: **5**
- Median wall time: **8.3 min**
- Max iterations: **12**
- Max wall time: **25.1 min**
- Total invalid emits: **18**
- Completion by event: **8**
- Completion by promise fallback: **8**

### By preset

| Preset | Runs | Avg iters | Avg min | Invalid emits | Completion profile |
|---|---:|---:|---:|---:|---|
| autocode | 7 | 4.71 | 7.55 | 6 | 4 promise / 3 event |
| autospec | 4 | 9.00 | 20.31 | 9 | 2 promise / 2 event |
| autosimplify | 3 | 4.33 | 6.05 | 2 | 1 promise / 2 event |
| autoideas | 1 | 10.00 | 13.66 | 1 | 1 event |
| autofix | 1 | 1.00 | 6.10 | 0 | 1 promise |

## What is working well

### 1. The system is shipping real work

This is the clearest positive signal. The latest run artifacts correlate with actual landed code/docs on `main`, including:

- environment-variable namespace migration
- dashboard root/API work
- health/watch/policy functionality
- worktree/isolation/operator-health documentation

The loops are not merely generating notes; they are producing implementation and documentation that survives review and lands in the repo.

### 2. Operational liveness is strong

The control plane currently looks healthy:

- no active stuck runs
- no recent failed runs surfaced by `loops health`
- all inspected recent runs reached terminal state

This means the scheduler/runtime/control-plane layer is already usable for day-to-day loop operation.

### 3. Autosimplify looks relatively efficient

`autosimplify` shows the best balance of throughput and cleanliness in this sample:

- low average runtime
- low invalid-emit count
- most completions via proper events instead of fallback

That suggests narrow, well-bounded transformation tasks fit the current loop architecture well.

### 4. Autoideas can produce durable advisory artifacts

`.autoloop/ideas-report.md` contains concrete, codebase-specific suggestions rather than vague brainstorming. The artifact is actionable, structured, and tied to exact surfaces such as `src/harness/display.ts`.

That is a good sign that the non-code presets can create useful upstream planning material.

## What is not working well enough yet

### 1. Completion discipline is only medium-strength

Half of the runs complete through `completion_promise` rather than the intended event route. That is acceptable as a safety valve, but too high as a normal operating mode.

Interpretation:

- loops often *finish the work*, but not always in the most trustworthy protocol shape
- the harness is still relying on a softer textual escape hatch more often than ideal
- event-topology alignment is not yet robust enough to treat the journaled event graph as fully authoritative

### 2. Invalid emits remain common

`18` invalid emits across `16` runs is the biggest runtime quality smell.

The journals show repeated patterns like:

- emitting `task.complete` too early
- emitting role-inappropriate events after a routing boundary
- requiring backpressure and re-prompting to recover

The loops usually recover, but this still burns iterations and weakens confidence in role discipline.

### 3. Shared-state contamination is still real

Metareview artifacts explicitly mention stale carryover in files like:

- `.autoloop/progress.md`
- `.autoloop/plan.md`
- `.autoloop/context.md`

This matters because it means:

- some loops begin from polluted local state
- a role can act on outdated task assignments
- the loop may spend iterations correcting its own workspace before advancing the objective

That is a direct drag on effectiveness even when the final run still completes.

### 4. Autospec is currently the weakest preset

`autospec` has the highest cost profile in the sample:

- highest average duration: **20.31 min**
- highest average iteration count: **9**
- highest invalid emits: **9 across 4 runs**
- repeated metareview involvement

Interpretation: it is still productive, but comparatively noisy and supervision-heavy. It is likely the preset most in need of routing/prompt hardening and better artifact hygiene.

## Preset-by-preset assessment

### Autocode — **effective, but still leans on fallback completion**

Strengths:

- ships real changes regularly
- average runtime is reasonable
- recent runs correspond to concrete landed work

Weaknesses:

- 4 of 7 runs completed via promise fallback
- some runs still show invalid early completion attempts

Verdict: **good current ROI**, but event discipline should improve.

### Autospec — **useful output, weakest operational efficiency**

Strengths:

- produces durable RFC/task artifacts
- handles larger/longer planning problems successfully

Weaknesses:

- highest noise and longest runtimes
- frequent invalid emits and metareview cleanup
- more vulnerable to stale-context drift

Verdict: **valuable but expensive**.

### Autosimplify — **best current operational shape**

Strengths:

- short runs
- low invalid-emit load
- good completion behavior

Weaknesses:

- smaller sample size

Verdict: **currently the healthiest preset in the sample**.

### Autoideas — **high-quality advisory output, slower but coherent**

Strengths:

- produced a useful structured report
- proper completion-event finish
- evidence of metareview actually improving run hygiene

Weaknesses:

- still incurred stale-context cleanup mid-run
- longish cycle for advisory work

Verdict: **effective, with room to reduce context drift**.

### Autofix — **promising but under-sampled**

Strengths:

- clean one-run sample
- zero invalid emits
- completed fast

Weaknesses:

- only one run in sample
- completed via promise fallback

Verdict: **encouraging, not yet enough data**.

## Current effectiveness rating

If I compress the current state into a single judgment:

- **Execution effectiveness:** high
- **Protocol cleanliness:** medium
- **Artifact quality:** medium-high to high
- **Operator trustworthiness:** medium-high
- **Best-fit task class:** bounded code changes and simplification passes

Overall rating: **7.5/10**

Reason:

- The loops are clearly generating useful repo outcomes.
- The system is operationally alive and non-stuck.
- But too much of the success still comes with routing mistakes, fallback completion, and stale shared-state cleanup.

## Most important next improvements

### 1. Reduce `completion_promise` as a normal path

Target: make promise fallback exceptional rather than routine.

Suggested goal:

- drive event-based completion above **75%** of successful runs

### 2. Harden preset-specific routing, especially `autospec`

The latest artifacts support the need for preset-aware supervision. Next step should be preset-aware prompt/routing hardening, not just monitoring.

Suggested goal:

- cut `autospec` invalid emits by at least half

### 3. Eliminate stale `.autoloop/*` carryover at run start

The journals show this is still a recurring source of wasted work.

Suggested goal:

- every run begins from validated or run-scoped working files
- metareview should not need to spend early cycles cleaning inherited state

### 4. Track effectiveness with explicit scorecard metrics

The repo now has the health-policy surface needed to do this. The next useful step is recording durable metrics such as:

- invalid emits per run
- completion_event vs completion_promise ratio
- metareview count per run
- iterations to terminal by preset
- stale-context interventions per run

## Bottom line

**Autoloop-ts is already effective enough to trust for real repo work, especially bounded implementation tasks.**

The latest artifacts show a system that:

- completes runs reliably,
- ships merged outcomes,
- and has improving operator visibility.

But it is **not yet clean enough to call fully mature** because too much success still depends on recovery behavior:

- backpressure after invalid emits,
- textual completion fallback,
- and metareview cleanup of stale state.

So the current answer is:

> **Effective in outcome, moderately inefficient in process.**

That is a good place to be — but the next leverage is clearly on **discipline and hygiene**, not on basic capability.
