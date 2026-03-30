# AutoFix miniloop

A autoloops-native bug diagnosis and repair loop.

AutoFix takes a bug report or failing test, reproduces the issue, traces the root cause, implements a minimal fix, and verifies the fix — all without refactoring or improving code beyond what is needed.

Shape:
- diagnoser — reproduces bug, traces root cause
- fixer — implements minimal fix
- verifier — tries to falsify the fix and checks for regressions
- closer — validates fix quality, manages multi-bug reports

## Fail-closed contract

AutoFix should reject weak fixes.

- No reproduction means no diagnosis.
- No before/after proof means no verified fix.
- A workaround, symptom mask, or regression tradeoff is not a clean close.
- When evidence is thin, reopening is better than pretending the bug is solved.

## How it works

1. **Diagnoser** parses the bug report, reproduces the issue, and traces the root cause to specific files and lines.
2. **Fixer** implements the minimal code change to address the root cause.
3. **Verifier** reruns the original failure, then the strongest relevant regression checks.
4. **Closer** reviews fix quality and decides whether more bugs need attention.

## AutoFix vs AutoCode

- **AutoFix** = starts from a bug. Minimal fix, regression check, no scope creep.
- **AutoCode** = starts from a feature request or task. Sliced implementation with full planning.

## Files

- `autoloops.toml` — loop + backend config
- `topology.toml` — role deck + handoff graph
- `harness.md` — shared harness rules loaded every iteration
- `roles/diagnoser.md`
- `roles/fixer.md`
- `roles/verifier.md`
- `roles/closer.md`

## Shared working files created by the loop

- `.autoloop/bug-report.md` — symptom, reproduction steps, root cause analysis
- `.autoloop/fix-log.md` — log of fixes applied with verification results
- `.autoloop/progress.md` — current bug tracking

## Run

From the repo root:

```bash
./bin/autoloops run presets/autofix "TypeError in parse_config when TOML has nested arrays"
```

Or with the installed shim:

```bash
autoloops run /path/to/tonic-loops/presets/autofix /path/to/target-repo
```
