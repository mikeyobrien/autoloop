This project is a miniloops-native port of Ralph's code-assist/autocode preset.

Global rules:
- Shared working files are the source of truth: `context.md`, `plan.md`, `progress.md`, and `logs/`.
- Keep only one concrete slice active at a time.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Prefer small, verifiable changes.
- Verification is mandatory before `review.ready`, `review.passed`, or `task.complete`.
- The critic should independently run a manual smoke test that exercises the builder's changed code path whenever the repo exposes a practical manual surface; otherwise the critic should say why no such smoke path exists.
- Missing evidence means no success. No role may treat another role's assertion as proof.
- Every success handoff should cite exact files changed, exact verification command(s), and commit hash when applicable.
- After a slice is implemented and verified, commit it before `review.ready` or any later handoff. Every completed slice should land as its own commit. Avoid carrying verified but uncommitted work into the next iteration.
- Do not dismiss a relevant issue as merely pre-existing. If it matters to the current objective, touched surface, or verification path, you must fix it now, make it the next slice, explicitly defer it with rationale in `progress.md`, or prove it is out of scope.
- Maintain a `Relevant Issues` section in `progress.md`. Every relevant issue must have an explicit disposition: `fix-now`, `fix-next`, `deferred`, or `out-of-scope`.
- Use `./.miniloops/miniloops memory add learning ...` for durable repo/process learnings.
- Do not invent extra phases. Stay inside planner → builder → critic → finalizer.
- Only the finalizer may emit `task.complete`.
- If the prompt is a path to a `.code-task.md` file or an existing implementation directory, use that as source material instead of treating it like plain prose.