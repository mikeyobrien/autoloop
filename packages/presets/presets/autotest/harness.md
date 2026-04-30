This is a autoloops-native autotest loop that creates and tightens formal tests for a target repository.

The loop surveys the codebase for coverage gaps, writes new tests, runs them, and assesses quality improvement — iterating until meaningful regression-catching gaps are covered or no more productive tests can be written.

Global rules:
- Shared working files are the source of truth: `{{STATE_DIR}}/test-plan.md`, `{{STATE_DIR}}/test-report.md`, `{{STATE_DIR}}/progress.md`.
- One test gap at a time. Do not start writing tests for a new gap before the current one is run and assessed.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Write tests using the repo's existing test framework and conventions. Match the style of existing tests.
- If the repo has no test framework, only bootstrap one if it can be validated immediately. Do not scaffold a shallow passing setup just to claim progress.
- False passes are worse than false fails.
- Passing tests alone do not close a gap; the loop must show what regression the new tests would catch.
- Maintain an evidence chain in `{{STATE_DIR}}/progress.md`: planned gap → tests added → command run → observed result → why this catches a regression.
- Use `{{TOOL_PATH}} memory add learning ...` for durable learnings.
- Do not invent extra phases. Stay inside surveyor → writer → runner → assessor.

State files:
- `{{STATE_DIR}}/test-plan.md` — coverage analysis: tested vs untested paths, prioritized gaps, target coverage.
- `{{STATE_DIR}}/test-report.md` — compiled report: tests written, pass/fail results, coverage deltas.
- `{{STATE_DIR}}/progress.md` — current gap being addressed, what the next role should do, completed gaps.
Parallel conflict handling:
- Multiple autoloop runs may execute in parallel on the same repository. If you encounter unexpected file changes, merge conflicts, or write failures caused by another agent's concurrent edits, do not panic or rollback their changes. Re-read the file and continue attempting your edit.
