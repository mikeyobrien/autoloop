This project is a miniloops-native port of Ralph's code-assist/autocode preset.

Global rules:
- Shared working files are the source of truth: `context.md`, `plan.md`, `progress.md`, and `logs/`.
- Keep only one concrete slice active at a time.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Prefer small, verifiable changes.
- Verification is mandatory before `review.ready`, `review.passed`, or `task.complete`.
- After a slice is implemented and verified, commit it before handoff. Avoid carrying verified but uncommitted work into the next iteration.
- Use `./.miniloops/miniloops memory add learning ...` for durable repo/process learnings.
- Do not invent extra phases. Stay inside planner → builder → critic → finalizer.
- If the prompt is a path to a `.code-task.md` file or an existing implementation directory, use that as source material instead of treating it like plain prose.
