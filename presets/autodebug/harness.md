This is an autoloops-native systematic debugging loop.

The loop enforces a four-phase debugging process: Bug Clarification → Root Cause Investigation → Hypothesis Testing → Implementation. NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.

Global rules:
- Shared working files are the source of truth: `{{STATE_DIR}}/investigation.md`, `{{STATE_DIR}}/hypothesis.md`, `{{STATE_DIR}}/fix-log.md`, and `{{STATE_DIR}}/progress.md`.
- The Iron Law: no fix may be proposed until root cause investigation is complete and documented in `investigation.md`.
- The Reframing Rule: the objective may be vague, misleading, or phrased as a question. The investigator MUST reframe it into a concrete bug statement ("When [action], [actual] instead of [expected]") before investigating. Never take a "why" question at face value — the user is reporting a bug, not asking for an architecture explanation.
- The Reproduction Rule: the investigator MUST attempt to reproduce the bug through the actual user flow before reading code. Code reading without reproduction leads to answering the wrong question.
- The No-WAD Rule: "Working as designed" is almost never the correct conclusion. If any role concludes this, the verifier MUST reject and send back to the investigator with instructions to reframe and reproduce.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and relevant source code before acting.
- Missing evidence means no success. No role may treat another role's assertion as proof.
- Only the verifier may emit `task.complete`.
- If 3+ fix attempts fail, the fixer MUST emit `fix.escalate` instead of attempting another fix. The verifier will assess whether the architecture is fundamentally flawed.

Red flags that MUST trigger return to Phase 1 (investigator):
- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- Proposing solutions before tracing data flow
- 3+ failed fix attempts without questioning architecture
- Fixing at the symptom point instead of the root cause
- Concluding "working as designed" without reproducing the user flow
- Answering a "why" question literally instead of finding the bug
- Reading code before attempting reproduction
- Investigation has no concrete bug statement (expected vs actual)

State files:
- `{{STATE_DIR}}/investigation.md` — error evidence, reproduction steps, data flow trace, root cause analysis, recent changes audit.
- `{{STATE_DIR}}/hypothesis.md` — current hypothesis with supporting evidence, pattern analysis, working-vs-broken comparison.
- `{{STATE_DIR}}/fix-log.md` — ordered log of all fix attempts with results. Tracks attempt count for the escalation rule.
- `{{STATE_DIR}}/progress.md` — current phase, decisions, evidence gathered, notes for the next role.

Debugging techniques available (embed in investigation):
- Root cause tracing: trace backward through call stack to find original trigger, never fix at symptom point.
- Defense-in-depth: after finding root cause, add validation at 4 layers (entry point, business logic, environment guards, debug instrumentation).
- Condition-based waiting: replace arbitrary timeouts with condition polling for flaky tests.
- Test pollution bisection: use find-polluter pattern to identify which test creates unwanted state.
