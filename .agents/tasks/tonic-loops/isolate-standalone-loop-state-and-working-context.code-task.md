# Task: Isolate Standalone Loop State And Working Context

## Description
Eliminate cross-run and cross-preset contamination for standalone miniloops runs. Today, standalone runs launched from the same repository root reuse shared runtime state (`.miniloop/journal.jsonl`, `.miniloop/memory.jsonl`, `pi-stream.*`, `pi-review.*`) and shared working files such as `.miniloop/progress.md`. That causes unrelated autocode, autoqa, autodoc, and hyperagent context to leak into later runs. The goal is to give each standalone loop an isolated working context comparable to chain step isolation, while preserving journal-first runtime truth and keeping inspection/debugging ergonomic.

## Background
Recent tracing showed that the bad autoqa inspector execution was not caused by run-id filtering bugs in scratchpad reconstruction. The harness correctly scopes scratchpad rendering with `read_run_lines(journal_file, run_id)`. The contamination came from state that is still shared at the cwd/project level:

- standalone runs default `work_dir` to `"."`
- runtime files default to repo-root `.miniloop/*`
- loop memory is injected from the shared `.miniloop/memory.jsonl`
- preset working files such as `.miniloop/progress.md` are reused across unrelated presets in the same repo root
- debug stream logs are named only by iteration (`pi-stream.1.jsonl`, `pi-review.1.jsonl`), so later runs overwrite earlier forensic evidence

Chains already avoid much of this by assigning each step its own work directory under `.miniloop/chains/<chain-run-id>/step-<n>/`. Standalone runs should get similar isolation rather than sharing the repo root by default.

The fix should stay simple and inspectable. Do not add a heavy state manager or opaque database. Prefer explicit directories and git-friendly files.

## Reference Documentation
**Required:**
- Design: `src/harness.tn`
- Design: `src/main.tn`
- Design: `src/config.tn`
- Design: `src/pi_adapter.tn`
- Design: `src/chains.tn`
- Design: `README.md`
- Design: `miniloops.toml`
- Design: `examples/autoqa/harness.md`
- Design: `examples/autoqa/roles/inspector.md`
- Design: `examples/autocode/harness.md`
- Design: `examples/autocode/README.md`

**Additional References (if relevant to this task):**
- `docs/configuration.md`
- `docs/journal.md`
- `src/memory.tn`
- `.miniloop/progress.md`
- `.miniloop/qa-plan.md`

**Note:** You MUST trace how `project_dir`, `work_dir`, journal paths, memory paths, child-process environment variables, and prompt-loaded working files interact before making changes. Preserve chain-step isolation and the journal-first model.

## Technical Requirements
1. Define and implement an isolation strategy for standalone runs so they do not default to sharing repo-root runtime state with unrelated presets.
2. Ensure standalone runs no longer inject unrelated memory from a shared cwd-level `.miniloop/memory.jsonl` unless that sharing is explicitly requested.
3. Ensure preset working context is isolated enough that an autoqa run does not accidentally consume autocode working files like `.miniloop/progress.md`, `.miniloop/context.md`, or `.miniloop/plan.md` from the repo root when they belong to a different preset/objective.
4. Preserve explicit chain-step isolation in `src/chains.tn`; do not regress existing per-step work directories.
5. Keep child-process environment wiring correct. Backends and the emit tool must receive paths for the active isolated run/work context, not stale repo-root defaults.
6. Update runtime file naming so raw Pi debug logs are not overwritten across runs. At minimum, include enough identity (for example `run_id`) to make stream logs for distinct runs coexist.
7. Preserve inspectability:
   - operators should still be able to inspect the active run’s prompt, scratchpad, coordination state, output, and raw streams
   - docs should explain where standalone run state now lives
8. Preserve the journal-first runtime model. Do not replace JSONL files with an opaque store.
9. Preserve simple defaults for users. Avoid requiring a large amount of new configuration just to run a preset.
10. Validate with focused runtime smoke checks plus `tonic check .`.

## Dependencies
- Existing runtime path resolution in `src/harness.tn` and `src/config.tn`
- Existing standalone CLI flow in `src/main.tn`
- Existing chain-step work-dir isolation in `src/chains.tn`
- Existing Pi stream logging in `src/pi_adapter.tn`
- Existing preset working-file contracts in `examples/autoqa/*` and `examples/autocode/*`

## Implementation Approach
1. Audit current path ownership for:
   - `project_dir`
   - `work_dir`
   - `core.state_dir`
   - journal file
   - memory file
   - preset working files
   - raw Pi debug logs
2. Choose the smallest explicit isolation scheme that works for standalone runs. Examples that may be acceptable:
   - a per-run work directory under `.miniloop/runs/<run-id>/`
   - a per-preset work directory under `.miniloop/<preset>/` plus per-run stream logs
   - another equally inspectable directory layout
3. Thread the chosen work context through backend/review child-process environment variables so emits, memory, and scratchpad reconstruction all target the correct run.
4. Update prompt-facing working-file loading so presets read the active isolated working context rather than unrelated repo-root files.
5. Update Pi stream/review log naming to avoid cross-run overwrite.
6. Document the new standalone state layout and inspection behavior.
7. Reproduce the contamination scenario with a targeted smoke test and confirm it no longer leaks unrelated autocode/help-fix context into an autoqa inspector run.
8. Re-run `tonic check .`.

## Acceptance Criteria

1. **Standalone Memory Does Not Bleed Across Unrelated Presets**
   - Given a prior autocode or hyperagent run has written unrelated entries into repo-root loop memory
   - When a fresh standalone autoqa run starts
   - Then its prompt does not inject those unrelated learnings unless the operator explicitly opted into shared memory

2. **Standalone Working Files Are Isolated**
   - Given repo-root `.miniloop/progress.md`, `.miniloop/plan.md`, or `.miniloop/context.md` contain active autocode state
   - When a standalone autoqa run starts
   - Then the inspector does not consume those unrelated files as its own active working context

3. **Scratchpad And Routing Still Work For The Active Run**
   - Given the new isolation layout
   - When a standalone run executes multiple iterations
   - Then prompt reconstruction, scratchpad projection, and routing still reflect only that run’s own journal events

4. **Chain Step Isolation Still Works**
   - Given an inline chain or named chain run
   - When each step executes
   - Then each chain step still uses its own isolated work directory and no regression is introduced in chain behavior

5. **Raw Pi Logs No Longer Overwrite Across Runs**
   - Given two different standalone runs both reach iteration 1
   - When raw Pi stream logs are written
   - Then both runs’ logs remain available and distinguishable instead of one overwriting the other

6. **Emit Tool Targets The Active Isolated Context**
   - Given a backend emits an event during an isolated standalone run
   - When `miniloops emit ...` is invoked through the runtime wrapper
   - Then the event lands in the active run’s journal, not an unrelated repo-root journal

7. **Contamination Repro Is Fixed**
   - Given the previously observed contamination scenario where autoqa inspector picked up unrelated `--help` / autocode context
   - When the scenario is replayed after the change
   - Then the inspector prompt and output stay aligned with autoqa repository-surface discovery instead of unrelated prior work

8. **Validation Passes**
   - Given the repo after the change
   - When `tonic check .` is run
   - Then it succeeds without errors

## Metadata
- **Complexity**: High
- **Labels**: miniloops, isolation, runtime-state, autoqa, autocode, memory, journal, preset-context, debugging
- **Required Skills**: Tonic app development, runtime path design, CLI/runtime environment wiring, debugging distributed state, prompt/runtime boundary design
