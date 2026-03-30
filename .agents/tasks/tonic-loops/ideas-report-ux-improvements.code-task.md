# Task: Implement The Remaining Ideas Report UX Improvements As A Delta Workstream

## Description
Implement the remaining approved UX improvements from `ideas-report.md` as one umbrella delta workstream grounded in current repo state. The implementation must land the unfinished operator UX surfaces, reference overlapping existing task ownership explicitly, and keep delivery sliced so later code/simplify/QA loops can execute and verify the work incrementally.

## Background
The ideas report is useful, but it is no longer a literal to-do list.

Since the report was written, parts of the proposed UX batch have already landed:
- corrective guidance in invalid emit backpressure notes
- much of the `emit` / `inspect` / `memory` help coverage
- core preset canonicalization work
- prompt-facing scratchpad compaction

Other parts are only partially addressed, and several adjacent concerns are already owned by existing task artifacts:
- `.agents/tasks/tonic-loops/first-class-presets-and-cli-representation.code-task.md`
- `.agents/tasks/tonic-loops/require-explicit-preset-argument-and-fail-on-unknown-preset.code-task.md`
- `.agents/tasks/tonic-loops/compact-prompt-scratchpad-and-preserve-full-inspection.code-task.md`

This task therefore owns the **remaining UX delta**, not a blind replay of all 24 report items.

The work should be grouped by operator surface so it stays inspectable and tractable:
1. memory operator UX
2. recovery-oriented CLI and backpressure UX
3. human-readable duration UX
4. preset discovery and inspection UX
5. inspect/topology rendering UX

## Reference Documentation
**Required:**
- Design: `AGENTS.md`
- Design: `/Users/rook/AGENTS.md`
- Design: `ideas-report.md`
- Design: `docs/rfcs/ideas-report-ux-improvements.md`
- Design: `README.md`
- Design: `src/main.tn`
- Design: `src/memory.tn`
- Design: `src/config.tn`
- Design: `src/topology.tn`
- Design: `src/harness.tn`
- Design: `docs/memory.md`
- Design: `docs/configuration.md`
- Design: `docs/topology.md`
- Design: `docs/creating-presets.md`

**Existing related task artifacts to reference, not supersede:**
- `.agents/tasks/tonic-loops/first-class-presets-and-cli-representation.code-task.md`
- `.agents/tasks/tonic-loops/require-explicit-preset-argument-and-fail-on-unknown-preset.code-task.md`
- `.agents/tasks/tonic-loops/compact-prompt-scratchpad-and-preserve-full-inspection.code-task.md`

**Additional References (if relevant to a given slice):**
- `test/memory_test.tn`
- `test/config_test.tn`
- `test/topology_test.tn`
- `test/preset_test.tn`
- `test/harness_test.tn`

## Technical Requirements
1. Treat `ideas-report.md` as a delta against current code/docs/tests rather than a literal checklist.
2. Preserve explicit ownership boundaries with the existing preset and scratchpad task artifacts listed above.
3. Keep one umbrella implementation branch/task, but execute it in explicit slices with slice-local acceptance and validation.
4. Do not add new runtime layers, plugin systems, registries, caches, or opaque state stores to support these UX improvements.
5. Keep durable state and UX surfaces inspectable through plain files and existing runtime structures.

### Slice 1 — Memory operator UX
6. Improve memory ergonomics in the current memory surfaces by:
   - showing IDs in `memory list`
   - adding `memory find <pattern>`
   - adding `memory status`
   - warning when removing a nonexistent or already-inactive ID
7. Make memory budget pressure visible by:
   - appending a truncation footer/signal to rendered truncated memory
   - warning after `memory add` when the rendered memory exceeds prompt budget
8. Reuse existing memory materialization/rendering paths rather than adding a second store or cache.
9. Update memory docs/tests with the implementation.

### Slice 2 — Recovery-oriented CLI and backpressure UX
10. Finish missing/broken help and recovery coverage for CLI subcommands, especially the remaining `chain` gaps and invalid-operation catch-alls.
11. Improve `inspect` error output so it names valid targets and relevant formats.
12. Render invalid emit stderr as a structured recovery-oriented block rather than a dense single line.
13. Add near-miss guidance for mistyped event names when the intended allowed event is obvious enough to suggest.
14. Keep the implementation simple: a small set of helpers is fine, but do not build a generalized command registry framework.

### Slice 3 — Human-readable duration UX
15. Add duration parsing support for readable suffixed timeout values such as `5m`, `50m`, and `1h` in the relevant config access path(s).
16. Document and test suffixed durations as the canonical timeout form.
17. Render human-readable durations in timeout/stop/operator-facing messages rather than raw millisecond integers where those messages are user-facing.
18. Keep parser behavior explicit and narrow; do not turn this into a larger config-language redesign.

### Slice 4 — Preset discovery and preset inspection UX
19. Add a CLI path to list available built-in presets.
20. Improve unknown-preset errors so they enumerate the valid preset names.
21. Add `inspect preset <name>` for preset discovery/inspection.
22. Reuse shared preset enumeration/resolution helpers so list output, inspect output, and unknown-preset guidance cannot drift apart.
23. Keep this work aligned with the already-landed first-class preset model and fail-closed preset behavior.

### Slice 5 — Inspect and topology rendering UX
24. Add `inspect topology` as a richer inspect-only topology view.
25. Support a graph-oriented topology inspect format appropriate for terminal inspection.
26. Surface topology validation warnings based on existing role/emits/handoff consistency concepts already present in the repo/tests.
27. Improve inspect catch-all/help output with valid target/format guidance.
28. Add orientation metadata/header information to `inspect scratchpad` without regressing prompt-facing compaction.
29. Render coordination output more structurally when sections are large enough that bullet lists stop being readable.
30. Keep richer topology rendering inspect-only; do not replace or expand the compact runtime advisory block as part of this task.

### Cross-cutting requirements
31. Update docs alongside code in each slice; do not defer docs sync to a later cleanup pass.
32. Add or extend targeted tests/integration checks for the specific CLI/help/inspect behaviors changed by the work.
33. Preserve short-run/simple-case readability; do not make small loops or small outputs noisier just to serve large runs.
34. Validate the full branch with `tonic check .` after the slices are integrated.

## Dependencies
- Current CLI dispatch and help/error paths in `src/main.tn`
- Current memory projection/rendering in `src/memory.tn`
- Current config parsing in `src/config.tn`
- Current topology loading/rendering in `src/topology.tn`
- Current harness inspect/backpressure rendering in `src/harness.tn`
- Existing docs describing config, memory, topology, and presets
- Existing tests covering memory/config/topology/presets/harness behavior

## Implementation Approach

### 1. Start with a report-to-current-state audit in code comments/notes if needed
Before changing behavior, confirm the implementation is still targeting the unfinished delta:
- mark already-landed report items as background only
- keep overlap with related preset/scratchpad tasks explicit
- avoid reopening settled canonical-path or scratchpad-compaction decisions

### 2. Implement slice-by-slice in this order
1. **Memory UX**
2. **CLI/backpressure UX**
3. **Duration UX**
4. **Preset discovery/inspection UX**
5. **Inspect/topology rendering UX**

This order front-loads operator recovery and low-level ergonomics before the broader inspect presentation work.

### 3. Keep each slice self-contained
For each slice:
- identify touched modules/files up front
- land docs updates in the same slice
- add/extend the most direct tests for that slice
- verify the operator-visible behavior before moving on

### 4. Reuse existing primitives wherever possible
- memory: `materialize`, current render helpers, current prompt-budget logic
- presets: shared preset enumeration/resolution helpers
- topology: existing role/emits/handoff concepts already enforced by tests
- inspect: existing dispatch/format plumbing rather than a new inspection subsystem

### 5. Preserve narrow boundaries
- topology improvements stay inspect-only
- scratchpad work is inspection metadata only, not a new compaction design
- duration support is a targeted parser/rendering improvement, not a general unit system
- help/error improvements should not balloon into a framework rewrite

### 6. Validation gates
At minimum, validate with:
- `tonic check .`
- targeted checks in or alongside:
  - `test/memory_test.tn`
  - `test/config_test.tn`
  - `test/topology_test.tn`
  - `test/preset_test.tn`
  - `test/harness_test.tn`
- focused CLI/help/integration checks for command-dispatch behavior where no dedicated test coverage exists today

## Acceptance Criteria

1. **The task implements only the unfinished UX delta**
   - Given the final branch
   - When a reviewer compares it against `ideas-report.md` and current repo state
   - Then already-landed work is not redundantly reimplemented
   - And overlapping preset/scratchpad tasks remain explicitly referenced rather than silently superseded

2. **Memory UX becomes directly operable**
   - Given a repo with multiple memory entries and budget pressure
   - When an operator uses the memory CLI
   - Then they can list entries with IDs, search by text, inspect memory status, remove entries with accurate warnings, and see budget/truncation pressure clearly

3. **CLI mistakes become easier to recover from**
   - Given an operator or agent invokes invalid `memory`, `chain`, or `inspect` operations or emits an invalid event
   - When the command fails
   - Then the error output is structured and recovery-oriented, with useful valid-target/help guidance and typo hints where applicable

4. **Timeout configuration and messaging become readable**
   - Given timeout-related config/docs/messages after the change
   - When a reader or operator inspects them
   - Then canonical examples and messages use readable duration forms instead of forcing millisecond arithmetic

5. **Preset discovery is first-class from the CLI**
   - Given a user who does not know the available preset names
   - When they use the CLI
   - Then they can list presets, inspect a preset by name, and recover from unknown preset names using enumerated valid options

6. **Inspect/topology output becomes richer without broadening runtime scope**
   - Given a user inspecting topology, scratchpad, inspect usage, or coordination state
   - When they use the updated inspect surface
   - Then topology inspection is available with richer formats and warnings
   - And scratchpad/coordination output is easier to orient within
   - And the compact runtime advisory view remains a separate, narrower surface

7. **Docs and tests move with the code**
   - Given any slice in the implementation
   - When it lands
   - Then the relevant docs and targeted tests/checks are updated in the same workstream rather than deferred

8. **Implementation stays simple and inspectable**
   - Given the final design
   - When reviewed against repo tenets
   - Then it uses small helpers and explicit file-based behavior rather than new runtime machinery

9. **Validation passes**
   - Given the repo after the full delta lands
   - When `tonic check .` is run
   - Then it completes successfully

## Metadata
- **Complexity**: Large
- **Labels**: autoloops, ux, cli, memory, presets, inspect, topology, durations, backpressure, planning-delta
- **Required Skills**: CLI design, Tonic app development, operator UX, inspect surface design, config parsing, documentation maintenance, targeted testing
