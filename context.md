# Context: QA bugfix queue

## Objective
Work through the blocking findings in `qa-report.md` one bug at a time.

## Current focus
Bug 1 and bug 2 are fixed and closed.
The next active issue is **bug 3**: metrics JSON escaping is incomplete for `\\`, newline, and carriage return characters.

## Source of truth
- `qa-report.md` — upstream multi-bug QA report and remaining queue
- `.miniloop/bug-report.md` — current bug write-up for the active bug only
- `.miniloop/fix-log.md` — applied fix history and verification evidence
- `.miniloop/progress.md` — current slice, issue dispositions, exact commands, and next action

## Constraints
- One bug at a time.
- Keep fixes minimal and local to the active bug.
- Preserve canonical file paths exactly as they exist on disk: use `qa-report.md`, not `qa_report.md` or `.miniloop/qa-report.md`.
- If a shared `.miniloop/*` working file is missing, recreate it before continuing.
- Keep `.miniloop/progress.md` concise and maintain explicit dispositions for all relevant issues.
- Use the strongest available verification before closure.

## Acceptance criteria for the current bug
- Metrics JSON escapes `"`, `\\`, newline, and carriage return correctly.
- The emitted JSON stays valid when metric values contain those characters.
- Focused regression coverage exists for the failing escaping cases.
- Verification includes `tonic check .`, `bin/test`, and a manual `inspect metrics --format json` smoke check or equivalent reproduction.
