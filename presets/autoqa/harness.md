This is a autoloops-native autoqa loop that performs zero-dependency, domain-adaptive validation of a target repository.

The loop inspects a repo, identifies its domain and native validation surfaces, plans validation steps using only what the repo already provides, executes those steps, and compiles a `.autoloop/qa-report.md`.

Global rules:
- Shared working files are the source of truth: `.autoloop/qa-plan.md`, `.autoloop/qa-report.md`, `.autoloop/progress.md`.
- One validation step at a time. Do not start a new step before the current one is executed and recorded.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Zero external dependencies. Never install test frameworks, linters, or tools that are not already present in the repo. Use only what is already there.
- Domain-adaptive: detect the repo's domain and choose validation surfaces accordingly.
- Absence of evidence is unresolved, not pass.
- Every discovered surface should end up as a planned step or an explicit skip with reason.
- Maintain a status table in `.autoloop/progress.md` for each discovered surface: `pending | passed | failed | blocked | skipped`.
- Treat that status table plus any accepted results in `.autoloop/qa-report.md` as the cumulative carry-forward ledger. Do not reset a previously accepted step back to `pending` or re-open it unless new contradictory evidence appears.
- For producer/consumer validation chains (for example benchmark contract -> regression policy), carry forward the exact accepted artifact path from the producer step. Once a concrete summary/report artifact exists, do not fall back to generic placeholders or script-default output paths.
- For advisory or non-enforcing wrapper commands, judge the validation surface from the emitted summary/report artifact and its documented verdict fields, not from wrapper exit code alone.
- On `qa.continue`, the planner must refresh `.autoloop/qa-plan.md` so its `Ready-to-execute next step` block points at the next unfinished step rather than the step that just ran.
- When updating `.autoloop/progress.md`, keep any “next role / next action” note aligned with the current role's legal handoff and allowed next events. Do not skip routing stages by assigning work directly to a later role.
- In particular, the reporter either continues via `qa.continue`, escalates via `qa.failed`, or finishes via `task.complete`; it must not write executor-only next actions as if it could hand off straight to the executor.
- Do not convert “couldn’t verify” into “looks fine”.
- Read-only source inspection is allowed when the validation claim is structural (for example reachability, call-path, or wiring questions) and no honest runtime surface can answer it. Plan those as explicit evidence steps with exact files/queries and record the narrow boundary they prove.
- Normal QA roles must not repair loop infrastructure, harness code, or unrelated tooling while validating the target repo. If the loop/runtime itself breaks, record the blocker and hand off; only the hyperagent should make bounded loop-file hygiene edits.
- Use `./.autoloop/autoloops memory add learning ...` for durable learnings.
- Do not invent extra phases. Stay inside inspector → planner → executor → reporter.

State files:
- `.autoloop/qa-plan.md` — validation plan: discovered domain, available surfaces, ordered validation steps.
- `.autoloop/progress.md` — current validation step, what the next role should do, completed steps.
- `.autoloop/qa-report.md` — the compiled validation report with pass/fail results and evidence.