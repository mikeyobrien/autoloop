# AutoFix miniloop

A miniloops-native bug diagnosis and repair loop.

AutoFix takes a bug report or failing test, reproduces the issue, traces the root cause, implements a minimal fix, and verifies the fix — all without refactoring or improving code beyond what is needed.

Shape:
- diagnoser — reproduces bug, traces root cause
- fixer — implements minimal fix
- verifier — confirms fix works, checks for regressions
- closer — validates fix quality, manages multi-bug reports

## How it works

1. **Diagnoser** parses the bug report, reproduces the issue, and traces the root cause to specific files and lines.
2. **Fixer** implements the minimal code change to address the root cause.
3. **Verifier** runs the originally failing test, then the full suite to check for regressions.
4. **Closer** reviews fix quality and decides whether more bugs need attention.

## AutoFix vs AutoCode

- **AutoFix** = starts from a bug. Minimal fix, regression check, no scope creep.
- **AutoCode** = starts from a feature request or task. Sliced implementation with full planning.

## Files

- `miniloops.toml` — loop + backend config
- `topology.toml` — role deck + handoff graph
- `harness.md` — shared harness rules loaded every iteration
- `roles/diagnoser.md`
- `roles/fixer.md`
- `roles/verifier.md`
- `roles/closer.md`

## Shared working files created by the loop

- `bug-report.md` — symptom, reproduction steps, root cause analysis
- `fix-log.md` — log of fixes applied with verification results
- `progress.md` — current bug tracking

## Run

From the repo root:

```bash
./bin/miniloops run examples/autofix "TypeError in parse_config when TOML has nested arrays"
```

Or with the installed shim:

```bash
miniloops run /path/to/tonic-loops/examples/autofix /path/to/target-repo
```
