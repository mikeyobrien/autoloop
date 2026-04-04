# autoloop Platform Strategy Plan

> For Hermes: Use subagent-driven-development to execute this plan phase-by-phase. Treat autoloop as the control plane, not just a loop runner.

Goal: Turn autoloop from a strong loop harness into the default execution engine for long-horizon autonomous work, with a thin intake/supervision layer, first-class preset workflows, durable run tracking, and operator-grade monitoring.

Architecture: Keep the append-only journal and preset-driven event loop as the core. Build outward from that stable center: add a run registry, stronger operator surfaces, monitoring/watch flows, and a small supervisor layer that launches and tracks loops without duplicating orchestration logic. The control plane stays in autoloop; external shells (CLI, chat, cron, future API/UI) become ingestion and observation layers.

Tech Stack: TypeScript, Node.js ESM, Vitest, existing autoloop CLI/runtime, JSONL journals, preset directories, cron-based monitoring, background process execution.

---

## Strategic thesis

Make autoloop the default engine for any task that is:
- iterative
- quality-sensitive
- longer than a one-shot command
- worth journaling, inspecting, or resuming

Do not build a second orchestrator next to it.

Instead:
- autoloop = execution engine + state model + preset runtime
- CLI/chat/API = thin intake layer
- cron = supervisor and reporter
- journals/artifacts = source of truth
- workers/subagents/tools = execution surface

This plan assumes that direction and organizes the work into platform phases.

---

## Guiding constraints

- Keep the journal/artifact model canonical.
- Do not move orchestration logic into cron jobs or chat glue.
- Prefer additive operator surfaces over deep runtime redesigns.
- Preserve preset compatibility while growing the control-plane surface.
- Treat monitoring and registry data as operator views derived from canonical runtime state, not as a competing source of truth.
- Keep one-shot deterministic tasks out of autoloops unless they benefit from loop semantics.

---

## Desired end-state

1. autoloop is the default engine for long-running autonomous tasks.
2. Every run has a stable identity, lifecycle, and inspectable state.
3. Operators can answer: what is running, what changed, what is stuck, and what finished?
4. Presets become the main product surface for reusable workflows.
5. Chat and cron become thin launch/monitor/report shells.
6. Future API/UI work can sit on top of the same registry and journal model.

---

## Phase 1 — Establish autoloop as the control plane

### Task 1: Define the platform position in docs

Objective: Make the intended architecture explicit so future changes reinforce the control-plane model instead of reintroducing parallel orchestration concepts.

Files:
- Modify: `README.md`
- Modify: `docs/cli.md`
- Modify: `docs/auto-workflows.md`
- Modify: `docs/configuration.md`
- Create: `docs/platform.md`

Changes:
- Add a concise “autoloop as control plane” framing.
- Explain the architectural roles of:
  - presets
  - journals/artifacts
  - CLI/chat/API shells
  - cron/scheduled monitoring
- Document when autoloop should be used vs when a normal script/command is enough.
- Add a short “anti-goals” section: autoloop should not become a kitchen sink for trivial deterministic tasks.

Acceptance criteria:
- New contributors can explain the platform model from docs alone.
- Docs consistently describe external shells as thin layers over the runtime.

Suggested verification:
- Read `README.md` + `docs/platform.md` together and confirm they answer: what is autoloop, what launches it, what observes it?

Commit:
- `git commit -m "docs: define autoloop platform architecture"`

### Task 2: Standardize launch metadata for every run

Objective: Ensure every run has enough metadata to be indexed, tracked, and reported consistently.

Files:
- Modify: `src/harness/types.ts`
- Modify: `src/harness/index.ts`
- Modify: `src/harness/parallel.ts`
- Modify: `src/harness/journal.ts`
- Modify: `src/commands/run.ts`
- Create: `test/integration/run-metadata.test.ts`

Changes:
- Define a minimal runtime metadata shape for every run:
  - `run_id`
  - `preset`
  - `objective`
  - `project_dir`
  - `work_dir`
  - `created_at`
  - `backend`
  - `parent_run_id` (optional)
  - `trigger` (`cli`, `cron`, `chat`, `chain`, `branch`, etc.)
- Emit launch metadata into the journal on `loop.start` or a new startup event.
- Make sure branch and chain runs preserve lineage.

Acceptance criteria:
- Every run can be identified and explained without external context.
- Registry work in Phase 2 can derive initial state from launch metadata cleanly.

Suggested verification:
- Run one normal loop, one chain step, and one branch child; confirm lineage/metadata is present in artifacts.

Commit:
- `git commit -m "feat: standardize per-run launch metadata"`

---

## Phase 2 — Build the run registry and lifecycle model

### Task 3: Add a first-class run registry

Objective: Give operators and future APIs a fast status surface without replacing the journal as the source of truth.

Files:
- Create: `src/registry/types.ts`
- Create: `src/registry/index.ts`
- Create: `src/registry/update.ts`
- Create: `src/registry/read.ts`
- Create: `src/registry/render.ts`
- Modify: `src/harness/index.ts`
- Modify: `src/harness/iteration.ts`
- Modify: `src/harness/stop.ts`
- Modify: `src/harness/parallel.ts`
- Modify: `src/harness/wave.ts`
- Create: `test/registry/registry.test.ts`
- Create: `test/integration/registry-lifecycle.test.ts`

Changes:
- Create a registry file under the state tree, for example:
  - `.autoloop/registry/runs.jsonl`
  - or `.autoloop/runs/<run-id>/index.json`
- Define a derived lifecycle state model:
  - `running`
  - `completed`
  - `failed`
  - `timed_out`
  - `stopped`
  - `queued` / `blocked` (optional if introduced later)
- Update registry state at key runtime moments:
  - loop start
  - iteration progress
  - completion
  - backend failure
  - timeout
  - max-iterations stop
  - branch/join milestones
- Keep the registry reconstructible from journal data if needed.

Acceptance criteria:
- Operators can read high-level state without scraping the entire journal.
- Registry entries never become more authoritative than journal history.

Suggested verification:
- Kill a run in different ways and confirm registry state matches journal-derived truth.

Commit:
- `git commit -m "feat: add first-class run registry"`

### Task 4: Add lifecycle reconstruction and drift detection

Objective: Prevent registry drift and make the system self-healing.

Files:
- Create: `src/registry/rebuild.ts`
- Modify: `src/commands/list.ts`
- Modify: `src/commands/inspect.ts`
- Create: `test/integration/registry-rebuild.test.ts`

Changes:
- Implement a rebuild path that reconstructs registry state from journal files.
- Add a CLI path to rebuild or validate registry state.
- Detect mismatches between registry summary and journal-derived lifecycle.
- Prefer repairing derived state instead of failing hard.

Acceptance criteria:
- A damaged or missing registry can be rebuilt from canonical artifacts.
- Registry corruption does not permanently hide run status.

Commit:
- `git commit -m "feat: add registry rebuild and drift detection"`

---

## Phase 3 — Operator-grade loop management

### Task 5: Add `loops` operator commands

Objective: Make autoloop usable as an actual operating surface for multiple runs.

Files:
- Create: `src/commands/loops.ts`
- Create: `src/loops/list.ts`
- Create: `src/loops/show.ts`
- Create: `src/loops/render.ts`
- Modify: `src/main.ts`
- Modify: `src/usage.ts`
- Modify: `docs/cli.md`
- Create: `test/integration/loops-cli.test.ts`

Changes:
- Add commands such as:
  - `autoloop loops`
  - `autoloop loops --all`
  - `autoloop loops show <run-id>`
  - `autoloop loops artifacts <run-id>`
- Render concise summaries with:
  - run id
  - preset
  - status
  - last progress time
  - latest event
  - work dir / state dir
- Support partial run-id matching if practical.

Acceptance criteria:
- Operators can answer “what is running?” with one command.
- Loop status becomes discoverable without digging through directories.

Commit:
- `git commit -m "feat: add loops operator commands"`

### Task 6: Add a live watch/tail surface

Objective: Replace artifact spelunking and weak parent stdout polling with a purpose-built operator view.

Files:
- Create: `src/loops/watch.ts`
- Modify: `src/commands/loops.ts`
- Modify: `src/harness/display.ts`
- Modify: `docs/cli.md`
- Create: `test/integration/loops-watch.test.ts`

Changes:
- Add `autoloop loops watch <run-id>`.
- Tail journal or registry updates and render compact progress summaries in real time.
- Reuse the `[progress]` line vocabulary already introduced in the harness.
- Show timestamps, outcome, latest event, and stop reason clearly.
- Keep it text-first and stable before attempting a richer TUI.

Acceptance criteria:
- Operators can watch a run live without relying on raw backend chatter.
- Watch output remains readable for both single loops and multiple concurrent loops.

Commit:
- `git commit -m "feat: add live loop watch command"`

### Task 7: Add exception-focused monitoring summaries

Objective: Make scheduled monitoring useful instead of noisy.

Files:
- Create: `src/loops/health.ts`
- Modify: `src/commands/inspect.ts`
- Modify: `docs/cli.md`
- Create: `test/integration/loop-health.test.ts`

Changes:
- Add a health/report path that summarizes:
  - active loops
  - stalled loops
  - failed/time-out loops
  - loops with no progress beyond a threshold
- Return all-clear when nothing needs attention.
- Suppress healthy completed runs by default.

Acceptance criteria:
- Cron jobs can call one command and send exception-based updates.
- Healthy routine completions stop spamming chat.

Commit:
- `git commit -m "feat: add loop health and exception summaries"`

---

## Phase 4 — Presets as the product surface

### Task 8: Formalize preset manifests and taxonomy

Objective: Treat presets as first-class workflows, not just folders with config files.

Files:
- Create: `src/presets/types.ts`
- Create: `src/presets/load.ts`
- Create: `src/presets/manifest.ts`
- Modify: `docs/auto-workflows.md`
- Modify: `docs/creating-presets.md`
- Modify: `src/commands/list.ts`
- Create: `test/presets/manifest.test.ts`

Changes:
- Define a manifest schema for presets containing fields like:
  - name
  - category
  - objective class
  - expected artifact set
  - default stop policy
  - expected quality-gate events
  - suggested backend profile
  - tags
- Render preset listings from manifests rather than implicit folder knowledge alone.
- Document the distinction between preset taxonomy and runtime mechanics.

Acceptance criteria:
- Presets become enumerable and understandable without opening every folder manually.
- Future UI/API layers can describe presets from structured metadata.

Commit:
- `git commit -m "feat: formalize preset manifests"`

### Task 9: Add preset validation and scorecards

Objective: Keep the growing preset library coherent and production-safe.

Files:
- Create: `src/presets/validate.ts`
- Modify: `src/commands/list.ts`
- Modify: `src/commands/inspect.ts`
- Create: `test/integration/preset-validate.test.ts`
- Modify: `docs/creating-presets.md`

Changes:
- Add a validation command for presets checking:
  - required files exist
  - topology roles map correctly
  - completion/required events are coherent
  - documented artifacts match actual config/runtime expectations
- Produce a human-readable scorecard for preset quality.

Acceptance criteria:
- New presets fail fast when structurally broken.
- The preset library becomes governable instead of ad hoc.

Commit:
- `git commit -m "feat: add preset validation and scorecards"`

---

## Phase 5 — Thin supervisor layer for chat, cron, and future API

### Task 10: Define a stable launch contract

Objective: Make all external shells launch loops the same way.

Files:
- Create: `docs/launch-contract.md`
- Create: `src/launcher/types.ts`
- Create: `src/launcher/normalize.ts`
- Modify: `src/commands/run.ts`
- Create: `test/launcher/normalize.test.ts`

Changes:
- Define a normalized launch payload with fields such as:
  - objective
  - preset
  - project_dir
  - backend override
  - trigger source
  - reporting target
  - parent run id
  - tags / correlation id
- Make CLI launch path conform to the same internal contract future chat/API/cron integrations will use.

Acceptance criteria:
- External shells stop inventing their own run metadata conventions.
- Future API work can reuse the same contract instead of reverse-engineering CLI assumptions.

Commit:
- `git commit -m "refactor: add normalized launch contract"`

### Task 11: Add a local supervisor API surface

Objective: Prepare for web/chat integration without embedding orchestration logic outside the runtime.

Files:
- Create: `src/server/index.ts`
- Create: `src/server/routes/runs.ts`
- Create: `src/server/routes/presets.ts`
- Create: `src/server/routes/health.ts`
- Modify: `package.json`
- Modify: `README.md`
- Create: `test/server/runs-api.test.ts`

Changes:
- Add a lightweight local-only HTTP surface or programmatic API for:
  - creating runs
  - listing runs
  - showing run status
  - listing presets
  - fetching health summaries
- Keep the server thin: it should dispatch autoloop runs, not reimplement loop logic.
- Make this optional and local-first.

Acceptance criteria:
- A future chat bot or dashboard can talk to a stable API instead of scraping shell output.
- The server remains an adapter layer over the runtime/registry.

Commit:
- `git commit -m "feat: add local supervisor API surface"`

### Task 12: Define cron/reporting integration patterns

Objective: Make scheduled operations first-class without moving intelligence into cron jobs.

Files:
- Create: `docs/cron-operations.md`
- Modify: `docs/platform.md`
- Modify: `docs/cli.md`

Changes:
- Document standard scheduled behaviors:
  - start a loop
  - check active loops
  - report exceptions only
  - report daily analytics separately
- Standardize example output shapes for chat delivery.
- Explain how monitoring jobs should consume registry/health surfaces, not raw repo traversal.

Acceptance criteria:
- Cron jobs become predictable wrappers over autoloop operator commands.
- Monitoring/reporting responsibilities are clearly separated.

Commit:
- `git commit -m "docs: define cron supervision patterns"`

---

## Phase 6 — Platform analytics and governance

### Task 13: Add per-preset runtime analytics

Objective: Measure which workflows are effective, slow, flaky, or noisy.

Files:
- Create: `src/analytics/types.ts`
- Create: `src/analytics/presets.ts`
- Create: `src/analytics/runs.ts`
- Modify: `src/commands/inspect.ts`
- Modify: `docs/cli.md`
- Create: `test/integration/analytics.test.ts`

Changes:
- Compute analytics from journal + registry data:
  - runs by preset
  - avg runtime
  - avg iterations
  - completion reason distribution
  - failure/timeout counts
  - stale run rate
- Add an operator command for summaries.
- Keep analytics derived and reproducible.

Acceptance criteria:
- Product decisions about presets can be based on observed runtime data.
- Daily reports can be generated from an official command surface.

Commit:
- `git commit -m "feat: add preset runtime analytics"`

### Task 14: Add policy surfaces for budgets and escalation

Objective: Keep the system governable as run volume and autonomy increase.

Files:
- Create: `src/policy/types.ts`
- Create: `src/policy/evaluate.ts`
- Modify: `docs/configuration.md`
- Modify: `src/harness/config-helpers.ts`
- Create: `test/policy/policy.test.ts`

Changes:
- Introduce optional policy controls such as:
  - max wall-clock duration
  - max branch count by preset class
  - allowed backends by preset class
  - escalation thresholds for stuck loops
  - notification class (`silent`, `exception`, `verbose`)
- Keep these as operator constraints, not agent instructions.

Acceptance criteria:
- Autoloop can be run safely in more automated contexts.
- Governance logic stays declarative and inspectable.

Commit:
- `git commit -m "feat: add runtime policy surfaces"`

---

## Recommended delivery order

1. Phase 1 — control-plane framing + run metadata
2. Phase 2 — run registry + rebuild path
3. Phase 3 — loops commands + watch + health
4. Phase 4 — preset manifests + validation
5. Phase 5 — launch contract + optional supervisor API
6. Phase 6 — analytics + policy/governance

That order gives the fastest operator value while preserving architectural coherence.

---

## What not to build yet

- A complex web UI before the registry and loops commands exist
- Recursive loop-on-loop orchestration without bounded lineage and policy
- A second orchestration layer in chat code or cron code
- Rich TUI dashboards before text-first watch and health commands are stable
- “Universal autonomous execution” for trivial one-shot tasks that should remain scripts

---

## Success metrics

The strategy is working if the following become true:

- Most meaningful autonomous tasks are launched via autoloop presets.
- Operators can answer “what is running, what changed, what is stuck?” in under 30 seconds.
- Monitoring messages become exception-focused instead of noisy dump logs.
- New presets are easy to add, validate, and compare.
- Chat/API/cron integrations become thinner over time, not fatter.
- Debugging shifts from process spelunking to registry/journal inspection.

---

## Immediate next move

If executing this plan now, start with:
1. `docs/platform.md`
2. standardized launch metadata
3. first-class run registry
4. `loops` command family
5. `loops watch` and health summaries

That is the shortest path from “solid loop runtime” to “actual autonomous work operating system.”
