# autoloop Hardening and Productization Plan

> For Hermes: Use subagent-driven-development to execute this plan task-by-task.

Goal: Make autoloop coherent, testable, and easier to extend by fixing naming drift, adding deterministic end-to-end tests, introducing a mock backend, typing journal events, and modularizing the runtime.

Architecture: Keep the current event-driven loop model and append-only journal, but formalize the seams that are currently loose: CLI/docs naming, backend invocation, event encoding/decoding, and runtime execution boundaries. Build confidence first with deterministic testing and fixtures, then refactor the core behind a stable external interface.

Tech Stack: TypeScript, Node.js ESM, Vitest, TOML via @iarna/toml, existing CLI/runtime layout.

---

## Guiding constraints

- Preserve the current external workflow: bundled presets, `run`, `emit`, `inspect`, `memory`, `chain`, `pi-adapter`, `branch-run`.
- Prefer additive compatibility shims before removals.
- Keep the journal as the runtime source of truth.
- Refactor only behind green tests.
- Do not redesign presets and runtime simultaneously.

## Desired end-state

1. One canonical product/binary name across docs, examples, and preset guidance.
2. Deterministic end-to-end tests that do not require a live `pi` backend.
3. A first-class mock backend for local dev and CI.
4. Typed journal event parsing/formatting instead of ad hoc string extraction everywhere.
5. Smaller runtime modules with clearer boundaries.
6. Better operator tooling: timeline/event inspection and preset validation.

---

## Phase 1 — Coherence and confidence

### Task 1: Decide and document the canonical CLI identity

Objective: Eliminate naming ambiguity before changing behavior.

Files:
- Modify: `README.md`
- Modify: `package.json`
- Modify: `src/usage.ts`
- Modify: `src/main.ts`
- Modify: `docs/cli.md`
- Modify: `docs/creating-presets.md`
- Modify: `docs/journal.md`
- Modify: `docs/memory.md`
- Modify: `docs/topology.md`
- Modify: `docs/releasing.md`
- Modify: `presets/**/README.md`
- Modify: `presets/**/harness.md`

Changes:
- Choose one canonical operator-facing name. Recommendation: keep package/bin as `autoloop` and refer to legacy `autoloops` as an alias only if needed.
- Update all usage/help strings to print the same binary name.
- Add a short “naming compatibility” note in `README.md` if the repo directory remains `autoloop-ts`.
- Remove “partially stale / pre-TypeScript runtime” caveats once docs are corrected.

Acceptance criteria:
- No doc examples instruct `./bin/autoloops` unless explicitly described as a compatibility alias.
- `README.md`, `docs/cli.md`, and `src/usage.ts` agree on command names and flags.
- A repo-wide text search for legacy binary references returns only intentional compatibility notes.

Suggested verification:
- `npm test`
- Search for stale strings across repo

Commit:
- `git commit -m "docs: unify autoloop naming and CLI references"`

### Task 2: Add smoke tests for CLI help and naming consistency

Objective: Lock down the operator-facing command surface before deeper changes.

Files:
- Create: `test/cli.test.ts`
- Modify: `package.json` if a helper script is needed

Changes:
- Add tests that execute the compiled or source CLI entry and assert:
  - help output includes the canonical command name
  - listed subcommands match current implementation
  - `run --help`, `inspect --help`, `memory` usage, and `chain` usage are consistent
- Prefer `node` execution of source/compiled entry from tests; avoid shell-dependent wrappers.

Acceptance criteria:
- `test/cli.test.ts` passes locally and in CI.
- Help output drift becomes a test failure instead of a doc bug.

Commit:
- `git commit -m "test: cover CLI help and command naming"`

### Task 3: Introduce a deterministic fixture preset for integration tests

Objective: Create the smallest possible preset that exercises a full loop without involving complex bundled presets.

Files:
- Create: `test/fixtures/presets/minimal/autoloops.toml`
- Create: `test/fixtures/presets/minimal/topology.toml`
- Create: `test/fixtures/presets/minimal/harness.md`
- Create: `test/fixtures/presets/minimal/roles/planner.md`
- Create: `test/fixtures/presets/minimal/roles/finalizer.md`

Changes:
- Add a tiny preset with 2 roles and a short routing path:
  - `loop.start -> planner`
  - `tasks.ready -> finalizer`
  - completion on `task.complete`
- Keep it narrow and deterministic; no parallelism, no chains.

Acceptance criteria:
- The fixture preset is readable and used by later tests.
- The preset works with a scripted backend output.

Commit:
- `git commit -m "test: add minimal preset fixture for integration tests"`

### Task 4: Build a mock backend executable for tests and local debugging

Objective: Remove live backend dependency from CI and make runtime behavior reproducible.

Files:
- Create: `src/testing/mock-backend.ts`
- Create: `test/fixtures/backend/complete-success.json`
- Create: `test/fixtures/backend/invalid-event.json`
- Create: `test/fixtures/backend/no-completion.json`
- Create: `test/fixtures/backend/timeout.json`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/cli.md`

Changes:
- Add a small Node-based backend that reads a prompt and prints scripted output chosen by env var or fixture path.
- Support cases for:
  - valid completion
  - invalid emitted event
  - no completion event
  - timeout simulation
  - non-zero exit
- Document how to run autoloop with the mock backend.

Acceptance criteria:
- Mock backend can be launched via the existing backend override path.
- Tests can use it without `pi` on PATH.
- Running with the mock backend is documented in `README.md` or `docs/cli.md`.

Commit:
- `git commit -m "feat: add deterministic mock backend for tests and local runs"`

### Task 5: Add end-to-end loop tests using the mock backend

Objective: Lock the current runtime behavior before refactoring internals.

Files:
- Create: `test/integration/run-loop.test.ts`
- Create: `test/integration/emit-validation.test.ts`
- Create: `test/integration/inspect-artifacts.test.ts`
- Create: `test/helpers/runtime.ts`
- Modify: `vitest.config.ts`

Changes:
- Add integration coverage for:
  - successful completion
  - invalid event rejection
  - max-iteration stop
  - memory file creation
  - journal file creation
  - `inspect metrics`, `inspect scratchpad`, and `inspect memory`
- Use temp dirs and the fixture preset.
- Verify actual generated `.autoloop` artifacts, not just process exit codes.

Acceptance criteria:
- The project has green helper tests and green integration tests.
- A broken runtime path shows up in CI without requiring a real model backend.

Commit:
- `git commit -m "test: add end-to-end loop integration coverage"`

---

## Phase 2 — Runtime seams and event typing

### Task 6: Create a typed journal event codec

Objective: Replace stringly JSON field composition/parsing with typed event helpers.

Files:
- Create: `src/events/types.ts`
- Create: `src/events/encode.ts`
- Create: `src/events/decode.ts`
- Create: `src/events/guards.ts`
- Create: `test/events/codec.test.ts`
- Modify: `src/harness/journal.ts`
- Modify: `src/json.ts`

Changes:
- Define discriminated unions for core event families:
  - loop events
  - iteration events
  - backend events
  - emitted agent events
  - chain events
  - wave events
  - coordination events
- Add codec functions:
  - `encodeEvent(event)`
  - `decodeEvent(line)`
  - `isSystemEvent(event)`
  - `isRoutingEvent(event)`
- Keep compatibility with existing journal lines during migration.

Acceptance criteria:
- Existing journal artifacts still read correctly.
- New code can consume typed events instead of repeated `extractField` calls.
- Round-trip tests cover encode/decode across all core event variants.

Commit:
- `git commit -m "refactor: add typed journal event codec"`

### Task 7: Migrate journal consumers incrementally to typed events

Objective: Use the event codec in the highest-value readers first.

Files:
- Modify: `src/harness/metrics.ts`
- Modify: `src/harness/coordination.ts`
- Modify: `src/harness/scratchpad.ts`
- Modify: `src/harness/prompt.ts`
- Modify: `src/harness/emit.ts`
- Create: `test/harness/metrics.test.ts`
- Create: `test/harness/coordination.test.ts`

Changes:
- Start with read-only consumers:
  - metrics
  - coordination rendering
  - scratchpad rendering
- Then migrate routing-sensitive code in `prompt.ts` and `emit.ts`.
- Remove direct low-level string scanning where possible.

Acceptance criteria:
- Consumer modules become simpler and more explicit about event shapes.
- No user-visible behavior regressions in integration tests.

Commit:
- `git commit -m "refactor: migrate journal consumers to typed events"`

### Task 8: Extract backend runner abstraction

Objective: Separate runtime orchestration from backend-specific invocation details.

Files:
- Create: `src/backend/types.ts`
- Create: `src/backend/run-command.ts`
- Create: `src/backend/run-pi.ts`
- Create: `src/backend/run-mock.ts`
- Create: `src/backend/index.ts`
- Modify: `src/harness/index.ts`
- Modify: `src/harness/parallel.ts`
- Modify: `src/pi-adapter.ts`
- Create: `test/backend/backend-runner.test.ts`

Changes:
- Add a normalized backend result type:
  - output
  - exitCode
  - timedOut
  - provider kind
  - optional raw stream path
  - normalized error category
- Move process execution details out of harness files.
- Let the harness ask for a backend execution without caring if it is `pi`, command, or mock.
- Keep `pi-adapter.ts` as an adapter implementation, not an all-purpose fallback bucket.

Acceptance criteria:
- `src/harness/index.ts` no longer directly owns backend branching logic.
- The mock backend uses the same normalized result path as real backends.
- Timeout and failure behavior are tested at the backend layer.

Commit:
- `git commit -m "refactor: extract backend runner abstraction"`

---

## Phase 3 — Shrink the runtime surface area

### Task 9: Split `src/main.ts` into command handlers

Objective: Make CLI growth safe and readable.

Files:
- Create: `src/commands/run.ts`
- Create: `src/commands/inspect.ts`
- Create: `src/commands/memory.ts`
- Create: `src/commands/chain.ts`
- Create: `src/commands/list.ts`
- Create: `src/commands/pi-adapter.ts`
- Modify: `src/main.ts`
- Modify: `src/usage.ts`
- Create: `test/commands/*.test.ts` as needed

Changes:
- Move subcommand parsing/handling into focused modules.
- Keep `main.ts` as dispatch and process wiring only.
- Share common arg parsing helpers in a local utility if needed.

Acceptance criteria:
- `src/main.ts` becomes a thin dispatcher.
- Existing CLI behavior remains unchanged.

Commit:
- `git commit -m "refactor: split CLI handlers into command modules"`

### Task 10: Split `src/harness/index.ts` into runtime coordinator modules

Objective: Reduce the God-file effect in the main harness.

Files:
- Create: `src/harness/run-loop.ts`
- Create: `src/harness/review-loop.ts`
- Create: `src/harness/iteration.ts`
- Create: `src/harness/summary.ts`
- Modify: `src/harness/index.ts`
- Modify: `src/harness/display.ts`
- Modify: `src/harness/config-helpers.ts`

Changes:
- Keep `index.ts` as public exports/composition only.
- Move loop execution orchestration into `run-loop.ts`.
- Move review cadence logic into `review-loop.ts`.
- Move iteration body and summary assembly into dedicated modules.

Acceptance criteria:
- `src/harness/index.ts` becomes mostly wiring and exports.
- Run lifecycle behavior is still covered by integration tests.

Commit:
- `git commit -m "refactor: split harness runtime coordinator modules"`

### Task 11: Split `src/chains.ts` into static and dynamic chain concerns

Objective: Make chain logic easier to reason about and test.

Files:
- Create: `src/chains/types.ts`
- Create: `src/chains/load.ts`
- Create: `src/chains/run.ts`
- Create: `src/chains/budget.ts`
- Create: `src/chains/render.ts`
- Modify: `src/chains.ts`
- Create: `test/chains/run.test.ts`
- Create: `test/chains/budget.test.ts`

Changes:
- Separate:
  - TOML loading/parsing
  - chain execution
  - budget checks
  - rendering/state inspection
- Keep `src/chains.ts` as a facade during migration if import stability matters.

Acceptance criteria:
- Chain execution and budget behavior can be unit tested independently.
- Inline-chain and named-chain flows still pass integration coverage.

Commit:
- `git commit -m "refactor: modularize chain engine"`

### Task 12: Split `src/harness/wave.ts` into wave planning, launch, and join modules

Objective: Make parallel execution safe to modify without reading a 500-line file every time.

Files:
- Create: `src/harness/wave/parse-objectives.ts`
- Create: `src/harness/wave/plan-wave.ts`
- Create: `src/harness/wave/launch-branches.ts`
- Create: `src/harness/wave/join-branches.ts`
- Create: `src/harness/wave/finalize-wave.ts`
- Modify: `src/harness/wave.ts`
- Create: `test/harness/wave.test.ts`

Changes:
- Decompose the current wave flow into explicit stages.
- Isolate branch-spec construction and payload validation from process launching and join logic.
- Test invalid payloads, over-branch limits, branch failures, and successful joins.

Acceptance criteria:
- Parallel wave behavior is covered by deterministic tests using the mock backend.
- The wave code becomes stage-based instead of monolithic.

Commit:
- `git commit -m "refactor: modularize parallel wave execution"`

---

## Phase 4 — Operator tooling and product features

### Task 13: Add a timeline inspector

Objective: Make journal debugging human-readable.

Files:
- Create: `src/inspect/timeline.ts`
- Modify: `src/commands/inspect.ts` or `src/main.ts` depending on refactor timing
- Modify: `src/usage.ts`
- Modify: `docs/cli.md`
- Modify: `README.md`
- Create: `test/integration/inspect-timeline.test.ts`

Changes:
- Add `inspect timeline` or `inspect events`.
- Render a compact per-iteration timeline with columns such as:
  - iteration
  - recent event
  - emitted event
  - exit code
  - elapsed
  - invalid/rejected marker
  - branch/wave events if present
- Support `terminal`, `md`, and maybe `json` formats.

Acceptance criteria:
- A failed or looping run can be debugged from the timeline without reading raw JSONL.
- Help/docs include examples.

Commit:
- `git commit -m "feat: add human-readable timeline inspector"`

### Task 14: Add preset lint/doctor commands

Objective: Catch preset configuration bugs before runtime.

Files:
- Create: `src/presets/lint.ts`
- Create: `src/presets/doctor.ts`
- Create: `src/presets/types.ts`
- Modify: `src/main.ts` or `src/commands/*`
- Modify: `src/topology.ts`
- Modify: `docs/creating-presets.md`
- Create: `test/presets/lint.test.ts`

Changes:
- Add checks for:
  - missing role files
  - empty role deck
  - handoff target IDs not in role set
  - emitted events that never route usefully
  - legacy binary names in preset docs
  - invalid/missing preset files
- Provide readable diagnostics and non-zero exit on failures.

Acceptance criteria:
- Bundled presets can be linted in CI.
- Typical preset authoring mistakes are caught before `run`.

Commit:
- `git commit -m "feat: add preset lint and doctor commands"`

### Task 15: Add run replay/simulation support

Objective: Leverage the append-only journal for debugging and regression analysis.

Files:
- Create: `src/replay/types.ts`
- Create: `src/replay/rebuild.ts`
- Create: `src/replay/simulate.ts`
- Modify: `src/main.ts` or `src/commands/*`
- Modify: `docs/cli.md`
- Create: `test/replay/rebuild.test.ts`

Changes:
- Add a command or internal API to rebuild derived state from journal lines:
  - scratchpad
  - metrics
  - coordination
  - routing context
- Optionally add “simulate next routing decision from run X / iteration Y”.

Acceptance criteria:
- Given a journal file, the runtime can reconstruct derived artifacts deterministically.
- Replay tests prove artifact generation is stable.

Commit:
- `git commit -m "feat: add run replay and simulation support"`

---

## Phase 5 — Operational hardening

### Task 16: Centralize runtime failure policy

Objective: Make stop/retry/failure behavior explicit and testable.

Files:
- Create: `src/runtime/policy.ts`
- Create: `src/runtime/errors.ts`
- Modify: `src/harness/index.ts`
- Modify: `src/harness/parallel.ts`
- Modify: `src/harness/wave.ts`
- Modify: `src/chains.ts` or `src/chains/run.ts`
- Create: `test/runtime/policy.test.ts`

Changes:
- Normalize categories for:
  - timeout
  - backend failure
  - invalid event storm
  - max iteration stop
  - chain budget exhaustion
  - branch launch/join failure
- Define when to abort, retry, reroute, or summarize.
- Remove scattered stop-reason logic where feasible.

Acceptance criteria:
- Runtime policy decisions are testable without spinning the whole CLI.
- Stop reasons are consistent across single-run, chain, and wave paths.

Commit:
- `git commit -m "refactor: centralize runtime failure policy"`

### Task 17: Add run locking / concurrent execution safeguards

Objective: Avoid state corruption from overlapping runs in the same work tree.

Files:
- Create: `src/runtime/lock.ts`
- Modify: `src/harness/config-helpers.ts`
- Modify: `src/harness/index.ts`
- Modify: `docs/cli.md`
- Create: `test/runtime/lock.test.ts`

Changes:
- Add a lockfile in the state dir or work dir.
- Detect and reject overlapping runs unless an explicit override flag is provided.
- Document the behavior.

Acceptance criteria:
- Concurrent runs in the same state dir fail fast with a clear message.
- Stale locks can be cleaned up safely.

Commit:
- `git commit -m "feat: add run locking safeguards"`

---

## Recommended implementation order

1. Task 1 — naming/docs cleanup
2. Task 2 — CLI help tests
3. Task 3 — minimal fixture preset
4. Task 4 — mock backend
5. Task 5 — end-to-end integration tests
6. Task 6 — typed journal codec
7. Task 7 — migrate journal consumers
8. Task 8 — backend runner abstraction
9. Task 9 — split CLI handlers
10. Task 10 — split harness runtime coordinator
11. Task 11 — modularize chains
12. Task 12 — modularize waves
13. Task 13 — timeline inspector
14. Task 14 — preset lint/doctor
15. Task 15 — replay/simulation
16. Task 16 — centralized runtime policy
17. Task 17 — run locking

---

## Suggested CI milestones

Milestone A: Coherence + deterministic tests
- Tasks 1–5 complete
- CI no longer depends on `pi`
- Docs and help output are aligned

Milestone B: Typed runtime seams
- Tasks 6–8 complete
- Journal handling and backend invocation are safer

Milestone C: Maintainable internals
- Tasks 9–12 complete
- Large files are decomposed into testable modules

Milestone D: Better operator UX
- Tasks 13–15 complete
- Inspect/debug/preset authoring improve significantly

Milestone E: Reliability hardening
- Tasks 16–17 complete
- Runtime safety policy is explicit and enforced

---

## Risks and mitigations

Risk: Naming cleanup breaks user muscle memory.
- Mitigation: keep a compatibility alias if needed; document it explicitly.

Risk: Journal typing breaks compatibility with existing `.jsonl` artifacts.
- Mitigation: decode old format first; migrate writers after readers are stable.

Risk: Refactors destabilize runtime behavior.
- Mitigation: finish Tasks 3–5 before large internal changes.

Risk: Parallel wave refactor becomes an endless yak shave.
- Mitigation: do not touch wave internals until mock-backend integration tests exist.

---

## Definition of done

This plan is complete when:
- operator-facing naming is coherent,
- deterministic integration tests cover core runtime paths,
- journal events and backend execution are typed and modularized,
- major 500-line files are broken into stable modules,
- and debugging/validation tools make the runtime easier to trust.
