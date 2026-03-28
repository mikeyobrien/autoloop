# Task: Simplify Runtime Coordination Into The JSONL Journal

## Description
Push more miniloops runtime coordination state into the append-only JSONL journal while preserving editable markdown for curated intent. The goal is to make the journal the canonical source of truth for machine-owned runtime facts such as issue tracking, slice lifecycle, verification status, and commit-per-slice history, while reducing `.miniloop/progress.md` to a lightweight human-facing summary rather than the primary coordination store.

## Background
Miniloops already uses a journal-first runtime model for core loop events such as `loop.start`, `iteration.start`, `backend.start`, `backend.finish`, `iteration.finish`, and `loop.complete`. That part is working well.

What is still split awkwardly across prose files is higher-level coordination state:
- relevant issue tracking
- slice lifecycle state
- commit-per-slice status
- verification/ownership transitions
- hyperagent consolidation actions

Today these are often written into `.miniloop/progress.md` or implied by prompts, which makes them harder to inspect, enforce, and project consistently. The next step is to move more of this machine-owned coordination state into structured journal events while keeping authored markdown files for current plan/context and archived docs.

The intended architecture is:
- **Journal** = append-only runtime truth
- **Markdown working files** = current curated intent (`.miniloop/context.md`, `.miniloop/plan.md`, concise `.miniloop/progress.md`)
- **Docs** = archived context and durable reference material
- **Memory** = short durable lessons/preferences/meta notes

## Reference Documentation
**Required:**
- Design: `README.md`
- Design: `src/harness.tn`
- Design: `src/main.tn`
- Design: `harness.md`
- Design: `hyperagent.md`
- Design: `roles/build.md`
- Design: `roles/verify.md`
- Design: `roles/finalizer.md`
- Design: `.miniloop/progress.md`

**Additional References (if relevant to this task):**
- `src/memory.tn`
- `src/topology.tn`
- `examples/autocode/README.md`
- `examples/autocode/harness.md`
- `examples/autocode/roles/build.md`
- `examples/autocode/roles/critic.md`
- `examples/autocode/roles/finalizer.md`

**Note:** You MUST read the current journal/projection logic before implementation. Preserve the current journal-first principles instead of introducing a second competing state system.

## Technical Requirements
1. Define which runtime coordination state should become journal-canonical and which should remain curated markdown.
2. Add structured journal events for relevant issue lifecycle, including explicit disposition and ownership.
3. Add structured journal events for slice lifecycle, including verification and commit-per-slice facts.
4. Add structured journal events for context/memory consolidation actions when the hyperagent archives stale working context into `docs/`.
5. Ensure the new event schema is simple, append-only, and compatible with current inspection/projection patterns.
6. Update projections or summary surfaces so `.miniloop/progress.md` can become a lightweight summary rather than the only source of truth for issue/slice tracking.
7. Preserve `.miniloop/plan.md` and `.miniloop/context.md` as curated editable files rather than forcing them into pure event sourcing.
8. Preserve `docs/*.md` as authored archived context, not journal-only state.
9. Update prompts/docs so the loop relies on the journal for machine-owned state transitions instead of loose prose wherever possible.
10. Keep the design minimal: do not build a giant event-sourcing framework or rewrite the whole runtime.
11. Validate with `tonic check .`.

## Dependencies
- Existing JSONL journal event model in `src/harness.tn`
- Existing inspect/projection surfaces in `src/harness.tn` and `src/main.tn`
- Existing working-file contracts (`.miniloop/context.md`, `.miniloop/plan.md`, `.miniloop/progress.md`)
- Existing hyperagent context-consolidation expectations in `hyperagent.md`
- Current autocode prompt/role expectations around relevant issues and slice commits

## Implementation Approach
1. Audit the current runtime state that lives in journal events versus prose files.
2. Define a minimal event schema for:
   - relevant issues
   - slice lifecycle
   - slice commits
   - context archival / consolidation actions
3. Implement the new events in the harness at the points where those transitions actually occur.
4. Update projections or summary rendering so the current state can be reconstructed from the journal without depending on fragile prose parsing.
5. Reduce `.miniloop/progress.md` toward a concise operator-facing summary while preserving its usefulness for humans.
6. Update the relevant docs/prompts so roles treat the journal as canonical for machine-owned runtime transitions.
7. Re-read the changed files and validate with `tonic check .`.

## Acceptance Criteria

1. **Relevant Issue Lifecycle Is Structured**
   - Given a relevant issue discovered during a loop
   - When its state changes
   - Then the journal records structured issue lifecycle events with explicit disposition and owner instead of relying only on prose in `.miniloop/progress.md`

2. **Slice Lifecycle Is Structured**
   - Given a slice that is planned, implemented, verified, and committed
   - When those transitions occur
   - Then the journal records structured slice lifecycle events that make commit-per-slice history reconstructable from runtime facts

3. **Commit-Per-Slice Is Inspectable**
   - Given completed slices in the autocode loop
   - When a reader or projection inspects the run state
   - Then they can tell which slice was committed and with what commit hash from journal-derived state rather than only prose notes

4. **Hyperagent Consolidation Actions Are Recorded**
   - Given the hyperagent archives stale context into `docs/`
   - When that archival happens
   - Then the journal records structured consolidation/archival events so the cleanup is inspectable later

5. **Progress Summary Is No Longer The Sole Coordination Store**
   - Given the updated runtime model
   - When issue/slice state is needed
   - Then the canonical machine-owned facts come from the journal, while `.miniloop/progress.md` can remain a concise summary rather than the only source of truth

6. **Curated Markdown Stays Curated**
   - Given `.miniloop/plan.md`, `.miniloop/context.md`, and `docs/*.md`
   - When the simplification is complete
   - Then those files remain editable, curated artifacts rather than being replaced by raw event logs

7. **Docs Explain The Split Clearly**
   - Given the updated docs and prompts
   - When a contributor reads them
   - Then they can understand what belongs in the journal versus markdown working files versus docs versus memory

8. **Validation Passes**
   - Given the repo after the change
   - When `tonic check .` is run
   - Then it succeeds without errors

## Metadata
- **Complexity**: High
- **Labels**: miniloops, journal, runtime-state, event-sourcing, projections, hyperagent, autocode
- **Required Skills**: information architecture, event schema design, Tonic app development, prompt/runtime boundary design, projection design
