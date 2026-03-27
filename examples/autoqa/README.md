# AutoQA miniloop

A miniloops-native zero-dependency, domain-adaptive validation orchestrator.

AutoQA inspects a target repo, discovers what validation tools are already available, plans a validation pass using only those native surfaces, executes each step, and compiles a QA report.

Shape:
- inspector
- planner
- executor
- reporter

## How it works

1. **Inspector** surveys the repo — identifies the domain (web app, CLI, library, etc.) and lists every native validation surface (build system, type checker, linter, test suite, CLI smoke test, etc.).
2. **Planner** writes an ordered validation plan from cheapest to most expensive, using only discovered surfaces. Hands one step at a time.
3. **Executor** runs exactly the planned step, captures real output, and records pass/fail.
4. **Reporter** compiles results into `qa-report.md` and decides whether to continue, flag failures, or complete.

## Zero-dependency guarantee

AutoQA never installs frameworks, test runners, linters, or any tools. It uses only what the repo already has. If the repo has nothing, the report says so honestly.

## Files

- `miniloops.toml` — loop + backend config
- `topology.toml` — role deck + handoff graph
- `harness.md` — shared harness rules loaded every iteration
- `roles/inspector.md`
- `roles/planner.md`
- `roles/executor.md`
- `roles/reporter.md`

## Shared working files created by the loop

- `qa-plan.md` — validation plan with discovered surfaces and ordered steps
- `qa-report.md` — compiled validation report with pass/fail evidence
- `progress.md` — current step tracking

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
./bin/miniloops run examples/autoqa /path/to/target-repo
```

Or with the installed shim:

```bash
miniloops run /path/to/tonic-loops/examples/autoqa /path/to/target-repo
```

## AutoQA vs AutoTest

- **AutoQA** = validation orchestration using native, existing surfaces. Does not create tests.
- **AutoTest** (future) = formal test creation and test-suite tightening. Creates new test code.
