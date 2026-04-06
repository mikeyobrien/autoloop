<!-- category: planning -->
This preset turns the current branch into a reviewable pull request.

Global rules:
- Shared working files are the source of truth: `{{STATE_DIR}}/pr-request.md`, `{{STATE_DIR}}/pr-context.md`, `{{STATE_DIR}}/pr-draft.md`, `{{STATE_DIR}}/pr-result.md`, and `{{STATE_DIR}}/progress.md`.
- The job is to publish an accurate PR, not to implement missing code or babysit CI forever.
- Fresh context every iteration: re-read the shared working files, git state, and relevant source before acting.
- Use the event tool instead of prose-only handoffs.
- Missing evidence means no publish. If checks were not run, say so explicitly in the PR draft.
- Do not invent verification, issue links, labels, reviewers, or mergeability state.
- Prefer exact git / gh CLI evidence over summaries from earlier iterations.
- If `{{STATE_DIR}}/pr-request.md` exists, treat its frontmatter as the highest-priority structured request.
- The freeform objective prompt is still valid input, but structured request fields override it.
- Derive defaults when safe: head branch from git, base branch from repo default or `main`, mode defaults to `publish`, draft defaults to `false`.
- Do not publish from a dirty, ambiguous, or detached repo state without calling that out and blocking.
- If a PR already exists for the head branch, update it instead of creating a duplicate unless the request explicitly says otherwise.
- `publish-and-arm` means enable platform auto-merge if supported; do not keep polling.
- `publish-and-merge-if-green` means merge immediately only if checks are already green and mergeability is confirmed right now; otherwise arm auto-merge if available, or block with evidence.
- Stay inside collector -> drafter -> validator -> publisher. Do not merge responsibilities.
- Only the publisher may emit `task.complete`.

Role boundaries (strict):
- The collector normalizes the request and repo state into `{{STATE_DIR}}/pr-context.md`; it does not draft or publish.
- The drafter writes `{{STATE_DIR}}/pr-draft.md`; it does not validate or publish.
- The validator checks the draft against the actual repo state and request; it does not publish.
- The publisher performs the side effect (`gh pr create`, `gh pr edit`, `gh pr merge --auto`, etc.) and records the result.
