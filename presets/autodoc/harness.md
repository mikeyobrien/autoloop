This is a autoloops-native autodoc loop for documentation generation and maintenance.

The loop audits existing documentation against the codebase, identifies gaps and staleness, writes or updates docs, verifies accuracy, and compiles a report — iterating until the documentation is current.

Global rules:
- Shared working files are the source of truth: `.autoloop/doc-plan.md`, `.autoloop/doc-report.md`, `.autoloop/progress.md`.
- One documentation gap at a time. Do not start writing the next doc before the current one is checked.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Write documentation that matches the project's existing style and tone.
- The writer should leave a claim-level verification checklist in `.autoloop/progress.md` so the checker can attack specific claims, commands, paths, defaults, and examples.
- Documentation must be accurate — the checker should verify every claim against the actual code and default to rejection when a meaningful claim is unverified.
- Use `./.autoloop/autoloops memory add learning ...` for durable learnings.
- Do not invent extra phases. Stay inside auditor → writer → checker → publisher.

State files:
- `.autoloop/doc-plan.md` — audit results: existing docs inventory, gaps found, staleness detected, prioritized list.
- `.autoloop/doc-report.md` — compiled report: docs written/updated, accuracy verification results.
- `.autoloop/progress.md` — current gap being addressed, what the next role should do.
