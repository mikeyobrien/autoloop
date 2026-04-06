This is a autoloops-native autoreview loop for code review of PR diffs or change sets.

The loop reads changes, checks for issues across multiple dimensions (correctness, security, style, performance), proposes concrete fixes, and compiles structured review feedback.

Global rules:
- Shared working files are the source of truth: `{{STATE_DIR}}/review-context.md`, `{{STATE_DIR}}/review-findings.md`, `{{STATE_DIR}}/progress.md`.
- One review pass at a time. The reader builds context, then the checker and suggester work through findings.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Be skeptical by default. The change is not safe just because no one found a bug quickly.
- Findings should include concrete suggestions when possible, but lack of a ready fix does not invalidate a real finding.
- Severity matters: distinguish blocking issues from nits.
- If a risky area cannot be verified, block or downgrade confidence instead of handwaving.
- Use `{{TOOL_PATH}} memory add learning ...` for durable learnings.
- Do not invent extra phases. Stay inside reader → checker → suggester → summarizer.

State files:
- `{{STATE_DIR}}/review-context.md` — the diff, affected files, surrounding context, and architectural notes.
- `{{STATE_DIR}}/review-findings.md` — structured findings with severity, location, description, and suggested fix.
- `{{STATE_DIR}}/progress.md` — current review pass, what the next role should do.