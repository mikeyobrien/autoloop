# AutoReview miniloop

A miniloops-native code review loop for PR diffs and change sets.

AutoReview reads changes, checks for issues across correctness, security, style, performance, and maintainability, proposes concrete fixes, and compiles structured review feedback with a clear verdict.

Shape:
- reader — builds context around changes and maps review risk
- checker — skeptically checks for issues across multiple dimensions
- suggester — proposes concrete code fixes for each finding
- summarizer — compiles structured review with verdict

## Fail-closed contract

AutoReview is skeptical by default.

- Absence of findings is not approval.
- Approval requires checker coverage of the changed files and no unresolved unknowns.
- Missing context, risky ambiguity, or unreviewable areas should block or downgrade the verdict.
- COMMENT is healthier than a fake APPROVE.

## How it works

1. **Reader** reads the diff and surrounding code, builds architectural context and a risk map for the reviewer.
2. **Checker** reviews changes for correctness, security, style, performance, and maintainability issues. Classifies each as blocking/warning/nit.
3. **Suggester** writes concrete code suggestions for every finding.
4. **Summarizer** compiles the final review: grouped by severity, with verdict and unresolved risks.

## Files

- `miniloops.toml` — loop + backend config
- `topology.toml` — role deck + handoff graph
- `harness.md` — shared harness rules loaded every iteration
- `roles/reader.md`
- `roles/checker.md`
- `roles/suggester.md`
- `roles/summarizer.md`

## Shared working files created by the loop

- `review-context.md` — diff summary, affected files, architectural context, risk map
- `review-findings.md` — structured findings with suggestions and verdict
- `progress.md` — review pass tracking

## Run

From the repo root:

```bash
./bin/miniloops run presets/autoreview /path/to/target-repo
```

Or with the installed shim:

```bash
miniloops run /path/to/tonic-loops/presets/autoreview /path/to/target-repo
```
