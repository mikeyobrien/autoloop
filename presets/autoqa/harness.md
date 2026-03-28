This is a miniloops-native autoqa loop that performs zero-dependency, domain-adaptive validation of a target repository.

The loop inspects a repo, identifies its domain and native validation surfaces, plans validation steps using only what the repo already provides, executes those steps, and compiles a `.miniloop/qa-report.md`.

Global rules:
- Shared working files are the source of truth: `.miniloop/qa-plan.md`, `.miniloop/qa-report.md`, `.miniloop/progress.md`.
- One validation step at a time. Do not start a new step before the current one is executed and recorded.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Zero external dependencies. Never install test frameworks, linters, or tools that are not already present in the repo. Use only what is already there.
- Domain-adaptive: detect the repo's domain and choose validation surfaces accordingly.
- Absence of evidence is unresolved, not pass.
- Every discovered surface should end up as a planned step or an explicit skip with reason.
- Maintain a status table in `.miniloop/progress.md` for each discovered surface: `pending | passed | failed | blocked | skipped`.
- When updating `.miniloop/progress.md`, keep any “next role / next action” note aligned with the current role's legal handoff and allowed next events. Do not skip routing stages by assigning work directly to a later role.
- In particular, the reporter either continues via `qa.continue`, escalates via `qa.failed`, or finishes via `task.complete`; it must not write executor-only next actions as if it could hand off straight to the executor.
- Do not convert “couldn’t verify” into “looks fine”.
- Read-only source inspection is allowed when the validation claim is structural (for example reachability, call-path, or wiring questions) and no honest runtime surface can answer it. Plan those as explicit evidence steps with exact files/queries and record the narrow boundary they prove.
- Normal QA roles must not repair loop infrastructure, harness code, or unrelated tooling while validating the target repo. If the loop/runtime itself breaks, record the blocker and hand off; only the hyperagent should make bounded loop-file hygiene edits.
- Use `./.miniloop/miniloops memory add learning ...` for durable learnings.
- Do not invent extra phases. Stay inside inspector → planner → executor → reporter.

State files:
- `.miniloop/qa-plan.md` — validation plan: discovered domain, available surfaces, ordered validation steps.
- `.miniloop/progress.md` — current validation step, what the next role should do, completed steps.
- `.miniloop/qa-report.md` — the compiled validation report with pass/fail results and evidence.