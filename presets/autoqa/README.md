# AutoQA miniloop

Use when you want comprehensive validation of a codebase without writing custom test harnesses.

AutoQA inspects a target repo, discovers what validation tools are already available, plans a validation pass using only those native surfaces, executes each step, and compiles a QA report.

Shape:
- inspector
- planner
- executor
- reporter

## Fail-closed contract

AutoQA is adversarial toward claims of health.

- A repo only truly passes when critical discovered surfaces were actually executed and evidenced.
- Missing, blocked, or unverifiable surfaces are gaps, not silent passes.
- Only a `task.complete` report with explicit PASS evidence counts as all-clear.
- Zero-dependency means “use what exists”, not “guess optimistically”.

## How it works

1. **Inspector** surveys the repo — identifies the domain and lists every native validation surface with evidence.
2. **Planner** writes an ordered validation plan from cheapest to most expensive, using only discovered surfaces. Every surface becomes a step or an explicit skip.
3. **Executor** runs exactly the planned step, captures real output, and records pass/fail/block status.
4. **Reporter** compiles results into `.autoloop/qa-report.md` and decides whether to continue, fail, or complete.

## Zero-dependency guarantee

AutoQA never installs frameworks, test runners, linters, or any tools. It uses only what the repo already has. If the repo has nothing, the report says so honestly.

## Files

- `autoloops.toml` — loop + backend config
- `topology.toml` — role deck + handoff graph
- `harness.md` — shared harness rules loaded every iteration
- `roles/inspector.md`
- `roles/planner.md`
- `roles/executor.md`
- `roles/reporter.md`

## Shared working files created by the loop

- `.autoloop/qa-plan.md` — validation plan with discovered surfaces and ordered steps
- `.autoloop/qa-report.md` — compiled validation report with pass/fail evidence
- `.autoloop/progress.md` — current step tracking plus per-surface status

## Backend

This preset assumes the built-in Pi adapter:

```toml
backend.kind = "pi"
backend.command = "pi"
```

For deterministic local harness debugging only, switch to the repo mock backend:

```toml
backend.kind = "command"
backend.command = "../../examples/mock-backend.sh"
```

## Run

From the repo root:

```bash
autoloop run presets/autoqa /path/to/target-repo
```

## AutoQA vs AutoTest

- **AutoQA** = validation orchestration using native, existing surfaces. Does not create tests.
- **AutoTest** = formal test creation and test-suite tightening. Creates new test code.