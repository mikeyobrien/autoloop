This project uses the autocode preset by default.

Global rules:
- Shared working files are the source of truth: `.miniloop/context.md`, `.miniloop/plan.md`, `.miniloop/progress.md`, and `.miniloop/logs/`.
- Keep only one concrete slice active at a time.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Prefer small, verifiable changes.
- Verification is mandatory before `review.ready`, `review.passed`, or `task.complete`.
- For autocode review, the critic should independently run a manual smoke test that exercises the builder's changed code path whenever the repo exposes a practical manual surface; otherwise the critic should say why no such smoke path exists.
- When a change affects a user/operator-facing CLI or helper tool, smoke that surface directly (for example `./.miniloop/miniloops ...`) instead of relying only on a lower-level `tonic run ...` wrapper that may hide the real shell semantics.
- After a slice is implemented and verified, commit it before `review.ready` or any later handoff. Every completed slice should land as its own commit. Avoid carrying verified but uncommitted work into the next iteration.
- Do not dismiss a relevant issue as merely pre-existing. If it matters to the current objective, touched surface, or verification path, you must fix it now, make it the next slice, explicitly defer it with rationale in `.miniloop/progress.md`, or prove it is out of scope.
- Maintain a `Relevant Issues` section in `.miniloop/progress.md`. Every relevant issue must have an explicit disposition: `fix-now`, `fix-next`, `deferred`, or `out-of-scope`.
- Use `./.miniloop/miniloops memory add learning ...` for durable repo/process learnings.
- Do not invent extra phases. Stay inside planner → builder → critic → finalizer.
- Emit only from the allowed next-event set shown in the prompt. This loop stays on the normal workflow events unless topology/prompt explicitly allows extra side-channel emits; until then, keep `slice.*`, `issue.*`, and `context.archived` facts in `.miniloop/progress.md`.
- If the prompt is a path to a `.code-task.md` file or an existing implementation directory, use that as source material instead of treating it like plain prose.

State ownership split:
- **Journal** = machine-owned runtime facts from the routed workflow events that actually occurred
- **Markdown** = curated intent (`.miniloop/context.md`, `.miniloop/plan.md`, concise `.miniloop/progress.md` summary)
- **Docs** = archived reference material (`.miniloop/docs/*.md`)
- **Memory** = durable lessons, preferences, meta notes

Until topology explicitly supports additional coordination events, record slice start/verification/commit facts and issue dispositions in `.miniloop/progress.md`, commit messages, and review/finalizer handoffs rather than separate `slice.*` or `issue.*` emits.
