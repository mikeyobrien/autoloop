This is a miniloops-native autosimplify loop inspired by Claude Code's `/simplify` workflow.

Global rules:
- Shared working files are the source of truth: `.miniloop/simplify-context.md`, `.miniloop/simplify-plan.md`, and `.miniloop/progress.md`.
- Scope defaults to the current diff. If there is no diff, fall back to recently modified files. If the user explicitly names files or directories, respect that scope.
- Keep only one simplification batch active at a time.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Preserve behavior exactly. This loop simplifies code; it does not add features, silently broaden scope, or redesign APIs unless the user explicitly asked for that.
- Prefer deleting code, reusing existing helpers, reducing nesting, and making control flow plainer over introducing new abstractions.
- Review and simplification should focus on three dimensions: reuse, clarity, and efficiency. Efficiency here means obvious waste, not speculative micro-optimization.
- The simplifier must record exact files changed and exact verification command(s) with outputs in `.miniloop/progress.md` before claiming success.
- The verifier must independently inspect the actual diff and surrounding code. Another role's summary is not proof.
- Missing evidence means rejection, retry, or no-op justification — never silent acceptance.
- `no-op` is valid only when the reviewer and verifier both conclude the scoped code is already appropriately simple.
- Use `./.miniloop/miniloops memory add learning ...` for durable learnings.
- Do not invent extra phases. Stay inside scoper → reviewer → simplifier → verifier.
- Only the scoper may emit `task.complete`.

State files:
- `.miniloop/simplify-context.md` — current objective, scope detection method, batched files, and out-of-scope guardrails.
- `.miniloop/simplify-plan.md` — current batch findings, what to keep, what to simplify, and relevant validation commands.
- `.miniloop/progress.md` — active batch, edits made, verification evidence, rejected attempts, and next action.
