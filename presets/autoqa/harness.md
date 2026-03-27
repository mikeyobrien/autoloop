This is a miniloops-native autoqa loop that performs zero-dependency, domain-adaptive validation of a target repository.

The loop inspects a repo, identifies its domain and native validation surfaces, plans validation steps using only what the repo already provides, executes those steps, and compiles a `qa-report.md`.

Global rules:
- Shared working files are the source of truth: `qa-plan.md`, `qa-report.md`, `progress.md`.
- One validation step at a time. Do not start a new step before the current one is executed and recorded.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Zero external dependencies. Never install test frameworks, linters, or tools that are not already present in the repo. Use only what is already there.
- Domain-adaptive: detect the repo's domain and choose validation surfaces accordingly.
- Absence of evidence is unresolved, not pass.
- Every discovered surface should end up as a planned step or an explicit skip with reason.
- Maintain a status table in `progress.md` for each discovered surface: `pending | passed | failed | blocked | skipped`.
- Do not convert “couldn’t verify” into “looks fine”.
- Use `./.miniloops/miniloops memory add learning ...` for durable learnings.
- Do not invent extra phases. Stay inside inspector → planner → executor → reporter.

State files:
- `qa-plan.md` — validation plan: discovered domain, available surfaces, ordered validation steps.
- `progress.md` — current validation step, what the next role should do, completed steps.
- `qa-report.md` — the compiled validation report with pass/fail results and evidence.