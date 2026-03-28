# Archived active context — 2026-03-27

## Why this was archived
The active loop narrowed from a repo-wide backlog of 16 implementation tasks to a QA bugfix queue driven by `.miniloop/qa-report.md`.
Keeping the old backlog in `.miniloop/context.md` and `.miniloop/plan.md` was now hurting the loop:
- it no longer matched the live bugfix objective
- it kept stale slice instructions in every prompt
- it made the planner compete with old Tier 1-4 roadmap text instead of the next QA bug

## Archived summary

### Previous objective
Implement the pending `.agents/tasks/tonic-loops/*.code-task.md` work in dependency order, one slice at a time.

### Previous active slice
- First-Class Presets (Tier 3, Task 9)
- Move bundled `examples/auto*` presets to `presets/auto*`
- Update resolver paths, tests, docs, and CLI help

### Previously completed slices
1. Require Explicit Preset Argument — `649ff3e`
2. Access-Based Config — `a481a75`
3. Compact Run ID Encoding — `ccb5d81`
4. Store-Backed Iteration Context — `08e3b35`
5. Structured Logger Integration — `3d47cb8`
6. Regex Event Matching — `2e4e918`
7. CSV Metrics Export — `be040df`
8. Preset Test Harness — `4854014`

### Previous constraints
- One concrete slice at a time
- Verification mandatory before review
- Prefer small, verifiable changes

## What replaced it
The active working files were refocused on the QA bug queue:
- bug 1 (typed metrics JSON fields) is closed
- next active work is bug 2 from `.miniloop/qa-report.md`: decimal truncation in `parse_float_or_zero()`
- remaining findings are tracked in `.miniloop/progress.md` under `Relevant Issues`
