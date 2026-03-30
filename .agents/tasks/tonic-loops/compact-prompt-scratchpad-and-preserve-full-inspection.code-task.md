# Task: Compact Prompt Scratchpad And Preserve Full Inspection

## Description
Reduce scratchpad bloat in long-running loops by compacting older iteration entries before they are injected into normal iteration prompts and hyperagent review prompts, while preserving a richer full-history scratchpad for operator inspection and debugging. The goal is to cut prompt pressure at the right layer instead of relying on planners or hyperagents to manually prune around a projected artifact.

## Background
Today the scratchpad is projected directly from `iteration.finish` journal events. Every completed iteration contributes a section with the full `output` field, and that same renderer is reused for both prompt injection and `autoloops inspect scratchpad --format md`.

That design keeps the implementation simple, but it causes prompt growth to scale linearly with runtime history. Once a run gets long, the planner and hyperagent are forced to react to scratchpad bloat even though they do not actually own the scratchpad. The recent review note before iteration 25 is a good example: the system correctly identified scratchpad growth as the active risk, but the suggested fix targeted planner behavior rather than the projection layer that creates the problem.

The clean fix is to compact the scratchpad at render time for prompt consumers while preserving an inspectable richer view for humans. Journal history must remain canonical and append-only. Do not rewrite old journal events or add ad hoc pruning steps to working files just to compensate for the renderer.

## Reference Documentation
**Required:**
- Design: `src/harness.tn`
- Design: `src/main.tn`
- Design: `docs/journal.md`
- Design: `docs/hyperagent.md`
- Design: `README.md`
- Design: `roles/plan.md`

**Additional References (if relevant to this task):**
- `hyperagent.md`
- `.autoloop/progress.md`
- `.agents/tasks/tonic-loops/isolate-standalone-loop-state-and-working-context.code-task.md` (for runtime inspectability posture)

**Note:** You MUST preserve journal-first runtime truth. The scratchpad is a projection, not owned mutable state. Fix the projection layer rather than introducing manual cleanup rituals.

## Technical Requirements
1. Split scratchpad rendering into at least two explicit views:
   - a compact prompt-facing view used for normal iteration prompts and hyperagent review prompts
   - a fuller inspection view used by `autoloops inspect scratchpad --format md`
2. Keep the compact prompt-facing scratchpad small and predictable for long runs. At minimum:
   - preserve the most recent few iterations in a fuller form
   - collapse older iterations to short one-line summaries
   - cap summary length so very noisy iterations do not dominate prompt space
3. Derive compact summaries from existing `iteration.finish` data without mutating journal history.
4. Preserve operator inspectability. `autoloops inspect scratchpad --format md` must still expose enough detail to debug a run without forcing operators to read raw journal JSON.
5. Keep the mechanism simple. Do not add a heavy summarization subsystem, extra runtime store, or LLM-based scratchpad compression.
6. Prefer hardcoded or minimal defaults over new config surface unless a setting is clearly necessary.
7. Update both normal iteration prompt construction and hyperagent review prompt construction to use the compact prompt-facing scratchpad.
8. Update docs so they explain that:
   - the scratchpad remains a projection from `iteration.finish`
   - prompt-injected scratchpad is compacted for context control
   - `inspect scratchpad` remains the richer debugging surface
9. Preserve current behavior for empty scratchpads and short runs; compact mode should not make short runs harder to read.
10. Validate with `tonic check .` and at least one targeted manual spot-check of projected scratchpad output on a multi-iteration run fixture or existing run journal.

## Dependencies
- Existing scratchpad projection code in `src/harness.tn`
- Existing inspect dispatch in `src/main.tn`
- Existing journal model documented in `docs/journal.md`
- Existing prompt assembly for iteration and review prompts

## Implementation Approach
1. Audit current scratchpad call sites and identify where one renderer is reused for both prompts and inspection.
2. Introduce a small pair of helpers or a mode-aware helper so prompt/review rendering and inspect rendering are clearly separated.
3. Define the compacting rule with the smallest mechanism that works. A good default would be:
   - keep the last 3–5 iterations full
   - render older iterations as a single summary line based on first non-empty content line or a truncated normalized excerpt
4. Ensure the compact renderer remains deterministic and cheap; no model calls, no external tools, no stateful cache.
5. Reuse the richer renderer for `inspect scratchpad --format md`, or add a clearly named compact/full distinction if needed, but do not silently remove debugging fidelity from the inspect path.
6. Update docs and any prompt language that currently implies the scratchpad is always a verbatim concatenation of full iteration outputs.
7. Run validation and manually inspect both views to confirm that prompts shrink while debugging remains ergonomic.

## Acceptance Criteria

1. **Prompt Scratchpad Compacts Older History**
   - Given a run with many completed iterations
   - When the harness renders the scratchpad for a normal iteration prompt
   - Then older iterations appear as short summaries rather than full raw outputs

2. **Recent Iterations Stay Readable In Prompts**
   - Given a run with recent builder and critic turns
   - When the prompt-facing scratchpad is rendered
   - Then the most recent few iterations still appear with enough detail for the next role to act without guessing

3. **Hyperagent Review Uses The Compact View**
   - Given a review pass triggered during a long-running loop
   - When the review prompt is rendered
   - Then it receives the compact scratchpad view instead of the unbounded full-history form

4. **Inspect Scratchpad Preserves Debugging Detail**
   - Given the same long-running loop
   - When an operator runs `autoloops inspect scratchpad --format md`
   - Then the output remains richer than the prompt-facing compact view and is still suitable for debugging

5. **Journal History Remains Canonical**
   - Given completed iterations already recorded in `.autoloop/journal.jsonl`
   - When scratchpad compaction is introduced
   - Then no journal events are rewritten, deleted, or truncated

6. **Short Runs Stay Simple**
   - Given a run with only a small number of completed iterations
   - When the compact scratchpad is rendered
   - Then the output stays effectively unchanged and easy to read

7. **Documentation Matches Runtime Behavior**
   - Given the updated implementation
   - When a reader checks `README.md` and the relevant docs
   - Then they can understand the difference between prompt scratchpad compaction and richer inspect output

8. **Validation Passes**
   - Given the repo after the change
   - When `tonic check .` is run
   - Then it succeeds without errors

## Metadata
- **Complexity**: Medium
- **Labels**: autoloops, scratchpad, prompts, hyperagent, journal, inspectability, context-pressure, ergonomics
- **Required Skills**: Tonic app development, prompt/runtime boundary design, journal projection design, CLI inspection UX, documentation maintenance
