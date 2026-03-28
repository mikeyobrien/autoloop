This is a miniloops-native autoideas loop that surveys a repository and generates an improvement report.

The loop scans a repo, identifies areas worth analyzing, produces concrete suggestions, validates them, and compiles an `.miniloop/ideas-report.md`.

Global rules:
- Shared working files are the source of truth: `.miniloop/ideas-report.md`, `.miniloop/scan-areas.md`, `.miniloop/progress.md`.
- One area at a time. Do not start analyzing a new area before the current one is validated.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Suggestions must be actionable, specific, and non-obvious. No generic advice.
- False positives are worse than false negatives. A healthy run may reject many areas and publish only a few ideas.
- Maintain clear role boundaries:
  - scanner updates `.miniloop/scan-areas.md`
  - analyst drafts suggestions in `.miniloop/progress.md`
  - reviewer records PASS/DROP verdicts in `.miniloop/progress.md`
  - synthesizer updates `.miniloop/ideas-report.md`
- If you catch yourself doing another role's job, stop and emit the blocking or rejection event instead.
- Do not trust summaries alone. Re-read the actual working files and source.
- Use `./.miniloop/miniloops memory add learning ...` for durable learnings.
- Do not invent extra phases. Stay inside scanner -> analyst -> reviewer -> synthesizer.

State files:
- `.miniloop/scan-areas.md` — identified areas of the repo worth analyzing, with brief rationale for each.
- `.miniloop/progress.md` — current area under analysis, what the next role should do, completed areas.
- `.miniloop/ideas-report.md` — the compiled output report with reviewer-validated suggestions.