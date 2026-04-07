This is an autoloops-native autoqa loop that performs zero-dependency, domain-adaptive, hands-on validation of a target repository.

The loop inspects a repo, identifies its domain and both native validation surfaces and drivable surfaces, plans validation steps that actively exercise the implementation as a real user would, executes those steps, captures UX observations alongside functional results, and compiles a `{{STATE_DIR}}/qa-report.md`.

Global rules:
- Shared working files are the source of truth: `{{STATE_DIR}}/qa-plan.md`, `{{STATE_DIR}}/qa-report.md`, `{{STATE_DIR}}/progress.md`.
- One validation step at a time. Do not start a new step before the current one is executed and recorded.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Zero external dependencies. Never install test frameworks, linters, or tools that are not already present in the repo or environment. Use only what is already there. The inspector must discover what tools are available — do not assume any specific tool exists.
- Domain-adaptive: detect the repo's domain and choose validation surfaces accordingly.
- Absence of evidence is unresolved, not pass.
- Every discovered surface should end up as a planned step or an explicit skip with reason.
- Maintain a status table in `{{STATE_DIR}}/progress.md` for each discovered surface: `pending | passed | failed | blocked | skipped`.
- Treat that status table plus any accepted results in `{{STATE_DIR}}/qa-report.md` as the cumulative carry-forward ledger. Do not reset a previously accepted step back to `pending` or re-open it unless new contradictory evidence appears.
- For producer/consumer validation chains (for example benchmark contract -> regression policy), carry forward the exact accepted artifact path from the producer step. Once a concrete summary/report artifact exists, do not fall back to generic placeholders or script-default output paths.
- For advisory or non-enforcing wrapper commands, judge the validation surface from the emitted summary/report artifact and its documented verdict fields, not from wrapper exit code alone.
- On `qa.continue`, the planner must refresh `{{STATE_DIR}}/qa-plan.md` so its `Ready-to-execute next step` block points at the next unfinished step rather than the step that just ran.
- When updating `{{STATE_DIR}}/progress.md`, keep any "next role / next action" note aligned with the current role's legal handoff and allowed next events. Do not skip routing stages by assigning work directly to a later role.
- In particular, the reporter either continues via `qa.continue`, escalates via `qa.failed`, or finishes via `task.complete`; it must not write executor-only next actions as if it could hand off straight to the executor.
- Do not convert "couldn't verify" into "looks fine".
- Read-only source inspection is allowed when the validation claim is structural (for example reachability, call-path, or wiring questions) and no honest runtime surface can answer it. Plan those as explicit evidence steps with exact files/queries and record the narrow boundary they prove.
- Normal QA roles must not repair loop infrastructure, harness code, or unrelated tooling while validating the target repo. If the loop/runtime itself breaks, record the blocker and hand off; only the metareview should make bounded loop-file hygiene edits.
- Use `{{TOOL_PATH}} memory add learning ...` for durable learnings.
- Do not invent extra phases. Stay inside inspector → planner → executor → reporter.

Hands-on driving mandate:
- AutoQA does not just run existing test suites and report exit codes. It actively drives the implementation as a real user would.
- If the repo produces a CLI, run it with real arguments — happy path and adversarial.
- If the repo starts a server, start it, hit its endpoints using whatever HTTP client is available, then stop it.
- If the repo has a TUI, drive it with piped input or expect-style sequences.
- If the repo is a library, exercise its public API with one-liner scripts.
- Running the existing test suite is necessary but not sufficient. The goal is to find issues that test suites miss — crashes on bad input, unhelpful error messages, silent failures, hangs, corrupted state.

UX critique mandate:
- AutoQA is critical of user-facing experience, not just functional correctness.
- Every hands-on driving step must record UX observations: error message quality, output formatting, timing, graceful degradation.
- UX findings are classified as `ux-bug` (broken/confusing UX) or `papercut` (minor rough edge).
- UX findings do not block a functional PASS but are prominently reported in `{{STATE_DIR}}/qa-report.md` with enough detail for autofix to act on them downstream.
- Do not soften findings. A stack trace shown to a user is a ux-bug. A missing --help flag is a ux-bug. An inconsistent flag name is a papercut. Be honest.

Process safety:
- Every server-start step must include cleanup (kill the process). Never leave orphan processes.
- Every TUI drive step must verify terminal state after exit.
- Log server output to `{{STATE_DIR}}/logs/` for evidence.
- If a driving step hangs (no output for 30 seconds), kill it and record BLOCKED with the evidence gathered so far.

State files:
- `{{STATE_DIR}}/qa-plan.md` — validation plan: discovered domain, available surfaces, drivable surfaces, ordered validation steps.
- `{{STATE_DIR}}/progress.md` — current validation step, what the next role should do, completed steps, UX observations per step.
- `{{STATE_DIR}}/qa-report.md` — the compiled validation report with pass/fail results, evidence, and UX findings.
- `{{STATE_DIR}}/logs/` — captured output from server drives, CLI runs, and other hands-on steps.
