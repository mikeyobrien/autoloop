This is a miniloops-native autotest loop that creates and tightens formal tests for a target repository.

The loop surveys the codebase for coverage gaps, writes new tests, runs them, and assesses quality improvement — iterating until coverage goals are met or no more productive tests can be written.

Global rules:
- Shared working files are the source of truth: `test-plan.md`, `test-report.md`, `progress.md`.
- One test gap at a time. Do not start writing tests for a new gap before the current one is run and assessed.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Write tests using the repo's existing test framework and conventions. Match the style of existing tests.
- If the repo has no test framework, install the idiomatic one for the language (e.g., pytest for Python, jest for JS/TS, cargo test for Rust).
- Use `./.miniloops/miniloops memory add learning ...` for durable learnings.
- Do not invent extra phases. Stay inside surveyor → writer → runner → assessor.

State files:
- `test-plan.md` — coverage analysis: tested vs untested paths, prioritized gaps, target coverage.
- `test-report.md` — compiled report: tests written, pass/fail results, coverage deltas.
- `progress.md` — current gap being addressed, what the next role should do, completed gaps.
