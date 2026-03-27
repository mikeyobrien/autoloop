This is a miniloops-native autoideas loop that surveys a repository and generates an improvement report.

The loop scans a repo, identifies areas worth analyzing, produces concrete suggestions, validates them, and compiles an `ideas-report.md`.

Global rules:
- Shared working files are the source of truth: `ideas-report.md`, `scan-areas.md`, `progress.md`.
- One area at a time. Do not start analyzing a new area before the current one is validated.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Suggestions must be actionable, specific, and non-obvious. No generic advice.
- Use `./.miniloops/miniloops memory add learning ...` for durable learnings.
- Do not invent extra phases. Stay inside scanner -> analyst -> reviewer -> synthesizer.

State files:
- `scan-areas.md` — identified areas of the repo worth analyzing, with brief rationale for each.
- `progress.md` — current area under analysis, what the next role should do, completed areas.
- `ideas-report.md` — the compiled output report with validated suggestions.
