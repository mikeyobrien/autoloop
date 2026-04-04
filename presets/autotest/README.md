# AutoTest miniloop

An autoloops-ts-native formal test creation and test-suite tightening loop.

AutoTest surveys a codebase for coverage gaps, writes new tests using the repo's existing framework and conventions, runs them, and assesses quality — iterating until meaningful regression-catching gaps are covered or no worthwhile gaps remain.

Shape:
- surveyor — analyzes codebase, finds coverage gaps, prioritizes
- writer — writes test code for identified gaps
- runner — executes tests, captures results
- assessor — skeptically evaluates test quality and coverage improvement

## Fail-closed contract

AutoTest is about better tests, not prettier coverage numbers.

- Skipped-only runs, zero-test passes, and vacuous assertions do not count as success.
- Passing tests alone do not prove the gap was worth closing.
- Completion means either meaningful new tests landed or the loop explicitly proved that remaining gaps are low-value, infeasible, or already covered.

## How it works

1. **Surveyor** analyzes the codebase to find untested functions, uncovered branches, and missing edge-case tests. Prioritizes gaps by risk.
2. **Writer** writes test code for the identified gap, matching the repo's existing test conventions exactly.
3. **Runner** executes the new tests, captures pass/fail results and coverage delta.
4. **Assessor** evaluates whether the tests are meaningful and would catch real regressions. Decides continue or complete.

## AutoTest vs AutoQA

- **AutoTest** = creates new formal tests. Writes code. Improves the test suite.
- **AutoQA** = validates using native surfaces that already exist. Does not create tests.

## Files

- `autoloops.toml` — loop + backend config
- `topology.toml` — role deck + handoff graph
- `harness.md` — shared harness rules loaded every iteration
- `roles/surveyor.md`
- `roles/writer.md`
- `roles/runner.md`
- `roles/assessor.md`

## Shared working files created by the loop

- `.autoloop/test-plan.md` — coverage analysis, prioritized gaps, test framework details
- `.autoloop/test-report.md` — compiled report with tests written, results, coverage deltas
- `.autoloop/progress.md` — current gap tracking and regression-catch rationale

## Run

From the repo root:

```bash
autoloops-ts run presets/autotest /path/to/target-repo
```
