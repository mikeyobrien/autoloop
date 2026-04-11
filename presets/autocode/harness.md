This project is a autoloops-native port of Ralph's code-assist/autocode preset.

Global rules:
- Shared working files are the source of truth: `{{STATE_DIR}}/context.md`, `{{STATE_DIR}}/plan.md`, `{{STATE_DIR}}/progress.md`, and `{{STATE_DIR}}/logs/`.
- Keep only one concrete slice active at a time.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Prefer small, verifiable changes.
- Verification is mandatory before `review.ready`, `review.passed`, or `task.complete`.
- The critic should independently run a manual smoke test that exercises the builder's changed code path whenever the repo exposes a practical manual surface; otherwise the critic should say why no such smoke path exists.
- Missing evidence means no success. No role may treat another role's assertion as proof.
- Every success handoff should cite exact files changed, exact verification command(s), and commit hash when applicable.
- After a slice is implemented and verified, commit it before `review.ready` or any later handoff. Every completed slice should land as its own commit. Avoid carrying verified but uncommitted work into the next iteration.
- Do not dismiss a relevant issue as merely pre-existing. If it matters to the current objective, touched surface, or verification path, you must fix it now, make it the next slice, explicitly defer it with rationale in `{{STATE_DIR}}/progress.md`, or prove it is out of scope.
- Maintain a `Relevant Issues` section in `{{STATE_DIR}}/progress.md`. Every relevant issue must have an explicit disposition: `fix-now`, `fix-next`, `deferred`, or `out-of-scope`.
- Use `{{TOOL_PATH}} memory add learning ...` for durable repo/process learnings.
- Do not invent extra phases. Stay inside planner → builder → critic → finalizer.
- Only the finalizer may emit `task.complete`.
- If the prompt is a path to a `.code-task.md` file or an existing implementation directory, use that as source material instead of treating it like plain prose.

Role boundaries (strict):
- The planner MUST NOT implement code, run tests, or make commits. It writes shared working files and emits `tasks.ready`.
- The builder implements the active slice, verifies it, commits it, and emits `review.ready`. It does not plan or review.
- The critic independently verifies the builder's work and emits `review.passed` or `review.rejected`. It does not build.
- The finalizer checks whole-task completeness and emits `queue.advance` or `task.complete`.
- If the routing topology says your next event is X, emit X — do not attempt completion or skip-ahead events.

Terminal blockers:
- If `build.blocked` has fired twice for the same reason, the planner MUST NOT re-plan the same blocker. Instead, update `{{STATE_DIR}}/plan.md` status to `TERMINAL BLOCKER` and emit `tasks.ready` so the builder can emit `build.blocked` one final time, routing to the finalizer for loop termination.
- The finalizer receiving a `build.blocked` route SHOULD check `{{STATE_DIR}}/plan.md` for `TERMINAL BLOCKER` status and emit `task.complete` with a failure summary rather than `queue.advance`.

Parallel conflict handling:
- Multiple autoloop runs may execute in parallel on the same repository. If you encounter unexpected file changes, merge conflicts, or write failures caused by another agent's concurrent edits, do not panic or rollback their changes. Re-read the file and continue attempting your edit.
