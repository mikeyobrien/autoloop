# RFC: Resumable Runs

**Status:** Draft
**Slug:** `autoloops-resume`
**Date:** 2026-04-10

## Summary

Add an `autoloops resume <run-id>` command that continues a previously-terminated run from where it left off, reusing the existing run_id, journal, memory, working files, and worktree. Since the harness already re-derives all routing and scratchpad state from the journal each iteration, resume is primarily a lifecycle/CLI concern — not a state reconstruction problem.

## Motivation

Runs currently terminate permanently on `backend_failed`, `backend_timeout`, `max_iterations`, and `interrupted` (SIGINT/SIGTERM). All critical state survives on disk — journal events, registry metadata, memory, working files, tasks, and git worktrees — but there is no way to continue from where the run left off. Users must start a new run, losing journal continuity, scratchpad history, and routing progress.

## Design

### CLI Interface

```
autoloops resume <run-id> [--add-iterations N] [-b <backend>] [-v]
```

| Flag | Default | Description |
|------|---------|-------------|
| `<run-id>` | required | Full or prefix match (uses existing `findRunByPrefix`) |
| `--add-iterations N` | original `max_iterations` | Additional iterations to grant beyond completed count |
| `-b <backend>` | original backend | Override backend (e.g., resume with a different model) |
| `-v` | off | Verbose logging |

### Resume Lifecycle

```
1. Look up RunRecord by run_id (findRunByPrefix)
2. Validate: not completed, not running (PID liveness check)
3. Determine resume iteration from journal
4. Build LoopContext from RunRecord + current config
5. Append loop.resume journal event
6. Update registry: status → running, new PID
7. Update worktree meta: status → running (if worktree mode)
8. Enter iteration loop at resume iteration
9. Normal run lifecycle from here (signal handlers, stop handlers, etc.)
```

### Same Run ID

Resume reuses the original `run_id`. The journal is append-only — resume appends a `loop.resume` event, then subsequent iterations append normally. `readRunLines(journalFile, runId)` returns all events for the run across original + resumed segments. `routingEventFromLines()` scans the full set and derives the correct routing state.

### Determining Resume Iteration

The resume iteration depends on the stop reason and journal state:

| Stop Reason | Registry `iteration` | Journal State | Resume At |
|-------------|---------------------|---------------|-----------|
| `max_iterations` | N-1 (completed) | `iteration.finish` for N-1 exists | N (the blocked iteration) |
| `backend_failed` | N (failed) | `iteration.start` for N exists, no `iteration.finish` | N (retry) |
| `backend_timeout` | N (timed out) | `iteration.start` for N exists, no `iteration.finish` | N (retry) |
| `interrupted` | N (was running) | May or may not have `iteration.finish` for N | Check journal: if `iteration.finish` for N exists → N+1, else → N |

Implementation: `determineResumeIteration(journalFile, runId, stopReason, registryIteration)`:
1. If `stopReason === "max_iterations"`: return `registryIteration + 1` (the iteration that was blocked).
2. If `stopReason === "backend_failed"` or `"backend_timeout"`: return `registryIteration` (retry the failed one).
3. If `stopReason === "interrupted"`: scan journal for `iteration.finish` where iteration === `registryIteration`. If found, return `registryIteration + 1`. If not, return `registryIteration`.

### Iteration Budget

Additive from the resume point. New effective `maxIterations = resumeIteration - 1 + addIterations`.

Example: original run had `max_iterations=10`, completed 7, stopped at `max_iterations`. Resume with `--add-iterations 5` → new max = 7 + 5 = 12. The run continues from iteration 8 with budget through 12.

If `--add-iterations` is not specified, default is the original `max_iterations` value from config.

### Building LoopContext for Resume

Resume cannot call `buildLoopContext()` directly because it:
1. Generates a new `runId` via `nextRunId()`
2. Creates a new worktree via `createWorktree()` (in worktree mode)

Instead, add `buildResumeContext(record, options)` that:
1. Uses `record.run_id` as the `runId` (no generation).
2. Uses `record.project_dir` to load config via `config.loadProject()`.
3. Uses `record.work_dir` as `effectiveWorkDir` (reattaches to existing worktree if applicable).
4. Derives `stateDir`, `journalFile`, `memoryFile`, `tasksFile` from the record's paths.
5. Calls `reloadLoop()` to fill in topology, backend, limits, etc. from current config.
6. Overrides `limits.maxIterations` with the computed resume budget.

This reuses `reloadLoop()` for config loading (same as every normal iteration) while skipping the one-time setup that `buildLoopContext` does.

### Topology Drift

`reloadLoop()` already re-reads `topology.toml` from disk every iteration. The system tolerates topology changes mid-run. Resume follows the same behavior — it loads the current topology, not the original.

If the topology changed between failure and resume, the routing state derived from journal may reference events that no longer exist in the handoff map. This can cause the agent to get stuck (no valid next roles). This is the same risk as editing topology mid-run today.

**Decision:** Warn if topology role IDs differ from what the journal references, but do not reject. Print: `"warning: topology roles changed since original run; routing may be affected"`.

### Parallel Waves

If a run was interrupted mid-wave, the `waves/active` marker was already cleaned up by the signal handler. On resume, the orchestrator iteration that launched the wave is retried (since it has no `iteration.finish`). It re-emits the parallel trigger, launching a fresh wave. Old branch results from the interrupted wave are orphaned in `waves/<old-waveId>/` but harmless.

### Worktree Reattachment

For worktree-mode runs, resume must reattach to the existing worktree rather than creating a new one:

1. Check `existsSync(record.worktree_path)` — fail if cleaned up.
2. Set `effectiveWorkDir = record.worktree_path`.
3. Set `worktreePath`, `worktreeBranch`, `worktreeMetaDir` from the record.
4. Update worktree meta status from `"failed"` back to `"running"`.

### Registry Status Lifecycle

```
running → failed/timed_out/stopped (terminal)
         ↓ (resume)
         running → ... (normal lifecycle continues)
```

Resume updates the registry entry: `status = "running"`, `pid = process.pid`, `updated_at = now`. No new status values needed.

### Idempotency and Safety

| Condition | Behavior |
|-----------|----------|
| Run is `completed` | Refuse: "run X already completed; cannot resume" |
| Run is `running`, PID alive | Refuse: "run X is still running (PID Y)" |
| Run is `running`, PID dead | Treat as crashed; safe to resume |
| Journal file missing | Refuse: "journal not found for run X" |
| State dir missing | Refuse: "state directory for run X not found" |
| Worktree cleaned up | Refuse: "worktree for run X was cleaned up; cannot resume" |
| `--add-iterations 0` | Refuse: "no iterations to run" |
| Config file deleted | Fail at `reloadLoop` (same as mid-run config deletion) |

PID liveness check: `try { process.kill(pid, 0); return true; } catch { return false; }`.

### Journal Event

Resume appends a `loop.resume` event before entering the iteration loop:

```json
{
  "run": "<run_id>",
  "topic": "loop.resume",
  "resumed_from_iteration": "<N>",
  "previous_stop_reason": "<reason>",
  "add_iterations": "<N>",
  "new_max_iterations": "<N>"
}
```

This event is a system topic — `routingEventFromLines()` ignores it (it's not a routing topic). The scratchpad renderer should include it as a visible marker so the agent knows the run was resumed.

### Scratchpad Rendering

`renderRunScratchpadPrompt()` should recognize `loop.resume` events and render them as a visible separator, e.g.:

```
--- resumed (was: max_iterations, adding 10 iterations) ---
```

This requires a small addition to the scratchpad renderer to handle the new topic.

## Implementation Surface

### New Files

| File | Purpose |
|------|---------|
| `src/commands/resume.ts` | CLI: parse args, look up run, validate, call `resume()` |
| `src/harness/resume.ts` | Core: `buildResumeContext()`, `determineResumeIteration()`, `resume()` entry point |

### Modified Files

| File | Change |
|------|--------|
| `src/main.ts` | Add `case "resume"` to dispatch switch, add to `isCliCommand` list |
| `src/harness/index.ts` | Export `resume` from `./resume.js` |
| `src/harness/scratchpad.ts` | Handle `loop.resume` topic in scratchpad rendering |
| `src/registry/derive.ts` | Handle `loop.resume` topic in `deriveRunRecords` (update status back to running) |
| `src/usage.ts` | Add resume to help text |

### No Changes Needed

| File | Reason |
|------|--------|
| `src/harness/prompt.ts` | `buildIterationContext` already re-derives everything from journal |
| `src/harness/iteration.ts` | Iteration runner is unchanged |
| `src/harness/stop.ts` | Stop handlers are unchanged |
| `src/harness/types.ts` | No new types needed (resume builds LoopContext directly) |
| `src/registry/types.ts` | Existing statuses are sufficient |

## Edge Cases

1. **Multiple resumes:** Each resume appends `loop.resume`. Budget is additive from the current resume point, not cumulative across all resumes.
2. **Resume after interrupted parallel wave:** Orchestrator iteration retried, fresh wave launched. Old wave results orphaned.
3. **Signal during resume:** Same signal handler as normal runs — records `interrupted` in registry, cleans wave marker.
4. **Resume with different backend:** Allowed. `reloadLoop` picks up current config. `-b` flag overrides further.
5. **Run-scoped isolation mode:** `stateDir` is `runs/<runId>/` — already exists from original run. Resume reuses it.
