This is a autoloops-native autofix loop for bug diagnosis and repair.

The loop takes a bug report or failing test, reproduces the issue, traces the root cause, implements a minimal fix, and verifies the fix — iterating if the initial attempt fails or if multiple bugs are reported.

Global rules:
- Shared working files are the source of truth: `{{STATE_DIR}}/bug-report.md`, `{{STATE_DIR}}/fix-log.md`, `{{STATE_DIR}}/progress.md`.
- Preserve canonical filenames exactly as they exist on disk. If the upstream report is `qa-report.md`, keep that spelling/path everywhere; never invent `qa_report.md` or move it under `{{STATE_DIR}}/` unless the file really lives there.
- If a shared working file is missing, recreate it before continuing. Do not keep going with a guessed or broken path.
- One bug at a time. Do not start fixing the next bug before the current one is verified and closed.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Prefer minimal fixes. Do not refactor, clean up, or improve code beyond what is needed to fix the bug.
- No reproduction => no diagnosis. No before/after proof => no verified fix.
- Regression verification is mandatory: the failing test must pass, and existing tests must not break.
- Record exact commands and key outputs in `{{STATE_DIR}}/progress.md` or `{{STATE_DIR}}/fix-log.md`, not just summaries.
- When refreshing structured markdown, read the current file first. If you are replacing most of a report/progress section, rewrite it cleanly instead of relying on brittle exact-text patching.
- Scope searches to repo paths or other paths you have confirmed exist. Do not spray `rg` or `find` across optional home-directory locations.
- Use `{{TOOL_PATH}} memory add learning ...` for durable learnings.
- Do not invent extra phases. Stay inside diagnoser → fixer → verifier → closer.
- If the diagnoser finds no bugs on first activation (build passes, all tests pass, no bug report or failing test), emit `task.complete` immediately. Do not re-confirm on subsequent iterations — one clean pass is sufficient.

State files:
- `{{STATE_DIR}}/bug-report.md` — the original bug report, reproduction steps, and root cause analysis.
- `{{STATE_DIR}}/fix-log.md` — log of fixes applied: what was changed, why, verification results.
- `{{STATE_DIR}}/progress.md` — current bug being fixed, what the next role should do.
Parallel conflict handling:
- Multiple autoloop runs may execute in parallel on the same repository. If you encounter unexpected file changes, merge conflicts, or write failures caused by another agent's concurrent edits, do not panic or rollback their changes. Re-read the file and continue attempting your edit.
