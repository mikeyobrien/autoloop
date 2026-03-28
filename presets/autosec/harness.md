This is a miniloops-native autosec loop for security audit and hardening.

The loop scans a target repo for security vulnerabilities, analyzes and confirms findings, implements fixes or mitigations, and compiles a prioritized security report.

Global rules:
- Shared working files are the source of truth: `.miniloop/sec-findings.md`, `.miniloop/sec-report.md`, `.miniloop/progress.md`.
- One finding at a time. Confirm/dismiss before moving to the next.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Minimize false positives. Every confirmed finding must have exploit evidence.
- Zero confirmed findings is a valid outcome.
- Fixes must not break functionality — verify after hardening.
- Missing exploit proof, missing fix verification, or unresolved preconditions should become dismissals or open risks, not confident confirmations.
- Use `./.miniloop/miniloops memory add learning ...` for durable learnings.
- Do not invent extra phases. Stay inside scanner → analyst → hardener → reporter.

State files:
- `.miniloop/sec-findings.md` — raw findings from scanning: location, type, severity, evidence.
- `.miniloop/sec-report.md` — compiled security report: confirmed findings, fixes applied, remaining risks.
- `.miniloop/progress.md` — current finding being analyzed, what the next role should do.