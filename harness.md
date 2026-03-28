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
- If the prompt is a path to a `.code-task.md` file or an existing implementation directory, use that as source material instead of treating it like plain prose.

State ownership split:
- **Journal** = machine-owned runtime facts (use coordination events below)
- **Markdown** = curated intent (`.miniloop/context.md`, `.miniloop/plan.md`, concise `.miniloop/progress.md` summary)
- **Docs** = archived reference material (`.miniloop/docs/*.md`)
- **Memory** = durable lessons, preferences, meta notes

Coordination events (emit these alongside normal workflow events):
- `issue.discovered "id=<id>; summary=<text>; disposition=<fix-now|fix-next|deferred|out-of-scope>; owner=<role>"` — record a relevant issue
- `issue.resolved "id=<id>; resolution=<text>"` — mark an issue resolved
- `slice.started "id=<id>; description=<text>"` — mark slice work beginning
- `slice.verified "id=<id>; method=<text>"` — mark slice verified
- `slice.committed "id=<id>; commit_hash=<hash>"` — record slice commit
- `context.archived "source_file=<path>; dest_file=<path>; reason=<text>"` — record context archival

Inspect coordination state: `./.miniloop/miniloops inspect coordination --format md`
