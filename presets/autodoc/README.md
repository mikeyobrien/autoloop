# AutoDoc miniloop

An autoloops-ts-native documentation generation and maintenance loop.

AutoDoc audits existing documentation against the codebase, identifies gaps and staleness, writes or updates docs, verifies accuracy, and tracks progress — iterating until documentation is current.

Shape:
- auditor — compares docs to code, finds gaps and staleness
- writer — writes or updates documentation for identified gaps
- checker — verifies documentation accuracy against actual code
- publisher — records completed work, manages gap queue

## How it works

1. **Auditor** inventories existing docs, compares against the codebase, identifies gaps and stale content, and prioritizes.
2. **Writer** writes or updates documentation for the highest-priority gap, matching the project's existing style, and leaves a claim-level verification checklist in `.autoloop/progress.md`.
3. **Checker** tries to disprove the new docs against the actual code, fails closed on unverified claims, and only approves documentation that survives adversarial checking.
4. **Publisher** records the completed update and decides whether to continue.

## Files

- `autoloops.toml` — loop + backend config
- `topology.toml` — role deck + handoff graph
- `harness.md` — shared harness rules loaded every iteration
- `roles/auditor.md`
- `roles/writer.md`
- `roles/checker.md`
- `roles/publisher.md`

## Shared working files created by the loop

- `.autoloop/doc-plan.md` — audit results, gaps, staleness, prioritized list
- `.autoloop/doc-report.md` — compiled report of documentation changes
- `.autoloop/progress.md` — current gap tracking plus the writer's claim-level verification checklist for the checker

## Run

From the repo root:

```bash
autoloops-ts run presets/autodoc /path/to/target-repo
```
