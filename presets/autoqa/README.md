# AutoQA

Use when you want adversarial, hands-on validation of a codebase — not just running existing test suites, but actively driving the implementation as a real user would and critiquing the UX.

AutoQA inspects a target repo, discovers what validation tools and drivable surfaces exist, plans a validation pass that exercises the implementation hands-on, executes each step while capturing UX observations, and compiles a QA report with both functional results and UX findings.

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
- Zero-dependency means "use what exists", not "guess optimistically".
- A passing test suite with hollow assertions is UNVERIFIED, not PASS.

## Hands-on driving

AutoQA doesn't just run the test suite and report the exit code. It actively drives the implementation:

- **CLIs**: runs with valid args, then with garbage — missing args, malformed input, unknown flags. Checks that error messages are helpful, exit codes are meaningful, and the process doesn't hang or crash.
- **Servers**: starts the server, waits for ready, hits endpoints using whatever HTTP client is available — valid requests then adversarial ones (malformed bodies, wrong content types, missing auth, oversized payloads). Checks response codes, error structure, and that the server doesn't crash. Stops the server after.
- **TUIs**: launches the app, pipes scripted input, sends Ctrl+C, verifies graceful exit and clean terminal state.
- **Libraries**: exercises the public API with one-liner scripts — valid input then invalid input. Checks that errors are thrown and descriptive.

## UX critique

Every hands-on step captures UX observations:

- **ux-bug**: broken or confusing UX that would frustrate a real user (stack traces shown to users, silent failures, hangs on bad input, corrupted terminal state).
- **papercut**: minor rough edge (inconsistent flag naming, missing progress indicator, messy output formatting).
- **ux-ok**: explicitly verified and acceptable.

UX findings don't block a functional PASS but are prominently reported with enough detail for autofix to act on them. Chain `autoqa → autofix` to automatically remediate.

## How it works

1. **Inspector** surveys the repo — identifies the domain, lists every native validation surface and drivable surface, probes for red flags and UX smells.
2. **Planner** writes an ordered validation plan from cheapest to most expensive, including hands-on driving steps with embedded UX criteria. Every surface becomes a step or an explicit skip.
3. **Executor** runs exactly the planned step — starts servers, drives CLIs, pipes TUI input, exercises APIs. Captures functional results and UX observations. Cleans up after (kills servers, verifies terminal state).
4. **Reporter** compiles results into `{{STATE_DIR}}/qa-report.md` with separate functional and UX verdicts. Decides whether to continue, fail, or complete.

## Zero-dependency guarantee

AutoQA never installs frameworks, test runners, linters, or any tools. It uses only what the repo and environment already have. The inspector discovers what tools are available (HTTP clients, PTY wrappers, language runtimes, process managers) and the planner adapts accordingly. If a driving tool is missing, the surface is skipped with reason — not faked.

## Files

- `autoloops.toml` — loop + backend config
- `topology.toml` — role deck + handoff graph
- `harness.md` — shared harness rules loaded every iteration
- `roles/inspector.md`
- `roles/planner.md`
- `roles/executor.md`
- `roles/reporter.md`

## Shared working files created by the loop

- `.autoloop/qa-plan.md` — validation plan with discovered surfaces, drivable surfaces, and ordered steps
- `.autoloop/qa-report.md` — compiled validation report with pass/fail evidence and UX findings
- `.autoloop/progress.md` — current step tracking plus per-surface status and UX observations
- `.autoloop/logs/` — captured output from hands-on driving steps

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

## Chaining

AutoQA finds issues. AutoFix fixes them. Chain them:

```bash
autoloop run autoqa,autofix /path/to/target-repo
```

## AutoQA vs AutoTest

- **AutoQA** = adversarial validation using native surfaces + hands-on driving. Does not create tests. Critiques UX.
- **AutoTest** = formal test creation and test-suite tightening. Creates new test code.
