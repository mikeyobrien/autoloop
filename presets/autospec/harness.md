This is a miniloops-native specification loop.

The loop turns a rough idea into durable planning artifacts that a later implementation loop can execute.

Global rules:
- Shared working files are the source of truth: `spec-brief.md`, `spec-research.md`, and `progress.md`.
- The goal is durable artifacts, not endless discussion.
- Default output paths are `docs/rfcs/<slug>.md` and `.agents/tasks/<project-name>/<slug>.code-task.md`.
- If the repo has a clearly stronger local planning convention, follow it and record that decision explicitly in `spec-brief.md`.
- Prefer the smallest artifact set that fully captures the decision. Keep intermediate files concise.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and relevant source material before acting.
- Do not implement product code. This loop writes and revises planning/specification artifacts only.
- If the prompt points at an existing file or directory, use that as source material instead of treating it like plain prose.
- Missing evidence means no completion. If something is unresolved, say so explicitly.
- Use `./.miniloops/miniloops memory add learning ...` for durable learnings.
- Do not invent extra phases. Stay inside clarifier → researcher → designer → planner → critic.
- Only the critic may emit `task.complete`.

State files:
- `spec-brief.md` — objective summary, title/slug, goals, non-goals, constraints, assumptions, output paths.
- `spec-research.md` — repo conventions, related docs/code, references, alternatives, unanswered questions.
- `progress.md` — current phase, artifact paths, revision notes, critic checklist.
