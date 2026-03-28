# Ideas Report UX Improvements

## Summary
Turn the approved UX-improvement ideas batch into one delta-shaped workstream that updates current miniloops operator UX without replaying already-landed work. The output is one umbrella RFC plus one executable task that later implementation loops can carry through code, simplification, and QA in clear slices.

Code task: `.agents/tasks/tonic-loops/ideas-report-ux-improvements.code-task.md`

## Problem
`ideas-report.md` usefully identified UX gaps, but the repo has moved since that report was written.

Several suggestions are already shipped, some are partially addressed, and some are already covered by related task artifacts. Treating the report as a literal 24-item checklist would duplicate ownership, mis-state current behavior, and send later implementation loops after work that is already done.

What is still missing is a durable delta spec that answers:
- which report items are still open
- which existing tasks already own adjacent ground
- how the remaining work should be grouped into tractable implementation slices
- which docs/tests must move with each slice so the UX stays inspectable and coherent

## Goals
- Convert the remaining approved report items into one explicit implementation plan.
- Treat the report as a delta against current code, docs, tests, and existing task ownership.
- Keep the implementation grouped by operator surface rather than report order.
- Preserve the repo’s narrow-core philosophy: small helpers, explicit files, no new runtime subsystems.
- Make later execution easy for `autocode`, `autosimplify`, and `autoqa` by defining concrete slices, touched surfaces, and validation gates.

## Non-goals
- Rewriting or superseding already-landed work.
- Inventing a new plugin/registry/help framework to support these UX improvements.
- Expanding topology work into a broader runtime or prompt redesign.
- Reopening existing preset canonicalization or scratchpad compaction decisions.
- Implementing product code in this planning loop.

## Delta Scope Map

### Already landed from `ideas-report.md`
These items are background only and are out of scope for the new task unless they need incidental adjustment:
- **#7** corrective directive in invalid emit backpressure note
- **Most of #10/#11** help coverage for `emit`, `inspect`, and `memory`
- **Core preset canonicalization behind #16-#18**
- **Core scratchpad compaction behind #23**

### Related work already owned elsewhere
This RFC references these tasks but does not replace them:
- `.agents/tasks/tonic-loops/first-class-presets-and-cli-representation.code-task.md`
- `.agents/tasks/tonic-loops/require-explicit-preset-argument-and-fail-on-unknown-preset.code-task.md`
- `.agents/tasks/tonic-loops/compact-prompt-scratchpad-and-preserve-full-inspection.code-task.md`

### This RFC owns the remaining UX delta
Open work remains in five slices:
1. memory operator UX
2. recovery-oriented CLI and backpressure UX
3. human-readable duration UX
4. preset discovery and inspection UX
5. inspect/topology rendering UX

## Proposed Design

### Slice 1 — Memory operator UX
Close the remaining memory ergonomics gaps in `src/memory.tn`, `src/main.tn`, and related docs/tests.

Planned behaviors:
- show memory IDs directly in `memory list`
- add `memory find <pattern>`
- add `memory status`
- warn on remove of nonexistent/already-inactive IDs
- surface prompt-budget pressure clearly:
  - truncation footer in rendered memory
  - warning after `memory add` when the rendered memory exceeds budget

Design constraints:
- keep memory projection-first and file-native
- reuse existing materialization/render paths
- warnings are operator guidance, not a second policy system

Validation surfaces:
- `test/memory_test.tn`
- targeted CLI checks for `memory list/find/status/remove`
- docs such as `docs/memory.md`

### Slice 2 — Recovery-oriented CLI and backpressure UX
Finish the remaining command-surface recovery work in `src/main.tn` and `src/harness.tn`.

Planned behaviors:
- complete bare-subcommand and `--help` coverage for `chain`
- add clear catch-all guidance for invalid `memory`, `chain`, and `inspect` invocations
- upgrade invalid emit stderr to a structured multi-line rejection
- add near-miss hints for mistyped event names when recovery is obvious

Design constraints:
- centralize literal help/recovery helpers if useful, but do not build a new registry layer
- optimize for fast operator/agent recovery after mistakes

Validation surfaces:
- focused CLI parser/help tests or integration checks
- targeted invalid emit/backpressure checks

### Slice 3 — Human-readable duration UX
Replace unreadable timeout values and messages with canonical suffixed durations while keeping the design simple.

Planned behaviors:
- support suffixed timeout values such as `5m`, `50m`, and `1h`
- document suffixed forms as canonical in presets/docs
- render human-readable durations in timeout/stop/operator-facing messages

Design constraints:
- canonical contract is readable suffixed forms
- raw millisecond integers may remain parseable if that naturally falls out of the parser, but they are not the preferred documented interface
- keep this as a focused config/rendering improvement, not a broader config DSL change

Validation surfaces:
- `test/config_test.tn`
- targeted harness/runtime checks for timeout text
- docs/preset templates that currently show timeout values

### Slice 4 — Preset discovery and inspection UX
Build on already-landed preset canonicalization rather than re-litigating it.

Planned behaviors:
- add `miniloops list` for built-in preset discovery
- improve unknown-preset errors to enumerate valid preset names
- add `inspect preset <name>` so operators can inspect preset metadata without manually traversing files

Design constraints:
- reuse shared preset enumeration/resolution helpers so list, inspect, and errors stay aligned
- speak in terms of canonical `presets/` behavior and current task ownership

Validation surfaces:
- `test/preset_test.tn`
- targeted CLI checks for list/inspect/unknown-preset output
- docs such as `docs/creating-presets.md` and relevant README sections

### Slice 5 — Inspect and topology rendering UX
Upgrade inspection output without expanding runtime scope.

Planned behaviors:
- add `inspect topology`
- support `inspect topology --format graph` with an inspect-only graph view
- surface topology validation warnings from existing role/emits/handoff consistency concepts
- improve inspect catch-all guidance with valid target/format combinations
- add scratchpad inspection metadata/header without undoing prompt compaction
- render larger coordination sections as tables when that improves readability

Design constraints:
- richer topology rendering stays inspect-only for this workstream
- do not replace the compact runtime advisory block with the fuller inspect view
- reuse existing topology consistency concepts already exercised in tests instead of inventing a separate lint subsystem

Validation surfaces:
- `test/topology_test.tn`
- `test/harness_test.tn`
- targeted inspect output checks for topology/scratchpad/coordination/help paths

## Execution Shape
Keep one umbrella task artifact, but require it to execute slice-by-slice. Each slice should:
- name touched files/modules/docs/tests
- define operator-visible acceptance
- avoid hidden ownership overlap with existing preset and scratchpad tasks

Recommended slice order:
1. memory UX
2. CLI/backpressure UX
3. duration UX
4. preset discovery/inspection UX
5. inspect/topology rendering UX

This order front-loads the lowest-level operator recovery improvements before the larger inspect surface work.

## Validation Strategy
The implementation task should require both focused slice checks and one final repo-level validation gate.

Expected validation mix:
- `tonic check .`
- targeted tests in `test/memory_test.tn`, `test/config_test.tn`, `test/topology_test.tn`, `test/preset_test.tn`, and `test/harness_test.tn`
- small CLI/help/integration checks where parser behavior is the thing being changed

## Risks And Boundaries
- **Ownership drift:** existing preset/scratchpad tasks must be referenced explicitly so this workstream does not silently supersede them.
- **Scope creep:** topology rendering must remain inspect-only.
- **Docs drift:** each slice must update docs/tests with code, not as a follow-up chore.
- **Staleness risk:** the task should preserve the report-to-current-state mapping so future reviewers can see why some report items were intentionally treated as already done or already owned.

## Open Questions
No design blockers remain. The remaining work is execution planning and later implementation.
