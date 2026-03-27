# AutoReview miniloop

A miniloops-native code review loop for PR diffs and change sets.

AutoReview reads changes, checks for issues across correctness, security, style, performance, and maintainability, proposes concrete fixes, and compiles structured review feedback with a clear verdict.

Shape:
- reader — builds context around changes
- checker — checks for issues across multiple dimensions
- suggester — proposes concrete code fixes for each finding
- summarizer — compiles structured review with verdict

## How it works

1. **Reader** reads the diff and surrounding code, builds architectural context for the reviewer.
2. **Checker** reviews changes for correctness, security, style, performance, and maintainability issues. Classifies each as blocking/warning/nit.
3. **Suggester** writes concrete code suggestions for every finding.
4. **Summarizer** compiles the final review: grouped by severity, with verdict (approve/request changes).

## Files

- `miniloops.toml` — loop + backend config
- `topology.toml` — role deck + handoff graph
- `harness.md` — shared harness rules loaded every iteration
- `roles/reader.md`
- `roles/checker.md`
- `roles/suggester.md`
- `roles/summarizer.md`

## Shared working files created by the loop

- `review-context.md` — diff summary, affected files, architectural context
- `review-findings.md` — structured findings with suggestions and verdict
- `progress.md` — review pass tracking

## Run

From the repo root:

```bash
./bin/miniloops run examples/autoreview /path/to/target-repo
```

Or with the installed shim:

```bash
miniloops run /path/to/tonic-loops/examples/autoreview /path/to/target-repo
```
