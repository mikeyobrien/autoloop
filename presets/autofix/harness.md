This is a autoloops-native autofix loop for bug diagnosis and repair.

The loop takes a bug report or failing test, reproduces the issue, traces the root cause, implements a minimal fix, and verifies the fix — iterating if the initial attempt fails or if multiple bugs are reported.

Global rules:
- Shared working files are the source of truth: `.autoloop/bug-report.md`, `.autoloop/fix-log.md`, `.autoloop/progress.md`.
- Preserve canonical filenames exactly as they exist on disk. If the upstream report is `qa-report.md`, keep that spelling/path everywhere; never invent `qa_report.md` or move it under `.autoloop/` unless the file really lives there.
- If a shared working file is missing, recreate it before continuing. Do not keep going with a guessed or broken path.
- One bug at a time. Do not start fixing the next bug before the current one is verified and closed.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Prefer minimal fixes. Do not refactor, clean up, or improve code beyond what is needed to fix the bug.
- No reproduction => no diagnosis. No before/after proof => no verified fix.
- Regression verification is mandatory: the failing test must pass, and existing tests must not break.
- Record exact commands and key outputs in `.autoloop/progress.md` or `.autoloop/fix-log.md`, not just summaries.
- When refreshing structured markdown, read the current file first. If you are replacing most of a report/progress section, rewrite it cleanly instead of relying on brittle exact-text patching.
- Scope searches to repo paths or other paths you have confirmed exist. Do not spray `rg` or `find` across optional home-directory locations.
- Use `./.autoloop/autoloops memory add learning ...` for durable learnings.
- Do not invent extra phases. Stay inside diagnoser → fixer → verifier → closer.

State files:
- `.autoloop/bug-report.md` — the original bug report, reproduction steps, and root cause analysis.
- `.autoloop/fix-log.md` — log of fixes applied: what was changed, why, verification results.
- `.autoloop/progress.md` — current bug being fixed, what the next role should do.