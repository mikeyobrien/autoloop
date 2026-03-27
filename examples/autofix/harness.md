This is a miniloops-native autofix loop for bug diagnosis and repair.

The loop takes a bug report or failing test, reproduces the issue, traces the root cause, implements a minimal fix, and verifies the fix — iterating if the initial attempt fails or if multiple bugs are reported.

Global rules:
- Shared working files are the source of truth: `bug-report.md`, `fix-log.md`, `progress.md`.
- One bug at a time. Do not start fixing the next bug before the current one is verified and closed.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Prefer minimal fixes. Do not refactor, clean up, or improve code beyond what is needed to fix the bug.
- No reproduction => no diagnosis. No before/after proof => no verified fix.
- Regression verification is mandatory: the failing test must pass, and existing tests must not break.
- Record exact commands and key outputs in `progress.md` or `fix-log.md`, not just summaries.
- Use `./.miniloops/miniloops memory add learning ...` for durable learnings.
- Do not invent extra phases. Stay inside diagnoser → fixer → verifier → closer.

State files:
- `bug-report.md` — the original bug report, reproduction steps, and root cause analysis.
- `fix-log.md` — log of fixes applied: what was changed, why, verification results.
- `progress.md` — current bug being fixed, what the next role should do.