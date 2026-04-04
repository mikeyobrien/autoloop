# autoloop Loop Operations Backlog

Purpose: Capture blind spots, operator pain, and control-plane improvements that would make autoloop easier to supervise, recover, and scale. This is not the main product roadmap; it is the backlog for loop management debt and operational leverage.

Status legend:
- `open` — identified, not started
- `next` — good candidate for the next implementation slice
- `watching` — partially mitigated, but still worth improving
- `done` — implemented and verified

---

## Backlog

### LOOP-OPS-001 — First-class run registry
- Status: next
- Problem: Supervising loops still requires reconstructing too much state from journal tails and artifacts.
- Why it matters: A registry would make it much easier to answer what is running, what finished, what is stuck, and what changed recently.
- Proposed improvement:
  - Add a derived run registry with lifecycle state, last progress timestamp, latest event, preset, objective, and paths.
  - Keep the journal canonical and make the registry rebuildable.
- Notes:
  - This is the key missing operator surface.

### LOOP-OPS-002 — Native `loops` command family
- Status: next
- Problem: There is no first-class operator command set for listing, inspecting, and watching active runs.
- Why it matters: External supervisors and humans both need a stable control surface instead of bespoke repo inspection.
- Proposed improvement:
  - Add `autoloop loops`, `loops show <run-id>`, `loops artifacts <run-id>`, and `loops watch <run-id>`.

### LOOP-OPS-003 — Live watch mode backed by journal/registry
- Status: next
- Problem: Background stdout polling is still secondary to artifact inspection, even after adding progress lines.
- Why it matters: Operators should not need to manually tail raw files to understand a run.
- Proposed improvement:
  - Implement `loops watch` using journal/registry updates.
  - Reuse concise `[progress]` vocabulary with timestamps.

### LOOP-OPS-004 — Better stuck-loop heuristics
- Status: open
- Problem: Current stuck detection is mostly time-based and supervisor-prompt based.
- Why it matters: Time-only checks are blunt; some loops are slow-but-healthy, others are fast-but-spinning.
- Proposed improvement:
  - Detect ineffective repetition, repeated invalid emits, repeated backend failures, repeated no-op planning, and no meaningful artifact deltas.
  - Surface a confidence score for `healthy`, `stalled`, `stuck`, or `off-track`.

### LOOP-OPS-005 — Off-track detection from objective vs artifact drift
- Status: open
- Problem: A supervisor can tell a loop is alive before it can tell whether the loop is actually doing the assigned slice.
- Why it matters: Healthy-looking loops can still waste hours producing elegant nonsense.
- Proposed improvement:
  - Compare stated objective, recent progress entries, touched files, and latest events.
  - Flag when work diverges materially from the assigned slice.

### LOOP-OPS-006 — Structured supervisor handoff/relaunch contract
- Status: open
- Problem: Relaunching a corrected loop currently depends on supervisor prompt craft more than a formal handoff contract.
- Why it matters: Recovery should be consistent, auditable, and less prompt-fragile.
- Proposed improvement:
  - Define a machine-readable relaunch envelope with previous run id, failure reason, observed drift/stall evidence, corrective constraints, and retry count.

### LOOP-OPS-007 — Explicit intervention history
- Status: open
- Problem: Supervisor actions like stop, relaunch, or escalation are not yet tracked in a durable operator-centric history view.
- Why it matters: We need an audit trail for what the supervisor did and why.
- Proposed improvement:
  - Record interventions in a registry/history artifact with timestamp, trigger, action, target run, and rationale.

### LOOP-OPS-008 — Per-run launch metadata standardization
- Status: next
- Problem: Runs lack a fully standardized metadata contract for trigger source, lineage, reporting target, and objective summary.
- Why it matters: Registry, API, cron, and chat supervision all get cleaner once launch metadata is normalized.
- Proposed improvement:
  - Standardize metadata on loop start for normal runs, chains, and branch children.

### LOOP-OPS-009 — Health summaries as a native command
- Status: next
- Problem: Monitoring logic currently lives too much in external cron prompts instead of the product surface.
- Why it matters: Health summaries should be a first-class command, not a recurring bespoke script.
- Proposed improvement:
  - Add a native health/exception summary command for cron and chat delivery.

### LOOP-OPS-010 — Timeout/failure taxonomy hardening
- Status: watching
- Problem: We already fixed one timeout-misclassification bug, which means more edge cases may be hiding in process wrappers.
- Why it matters: Supervisors make bad decisions if stop reasons are wrong.
- Proposed improvement:
  - Expand backend runner coverage for timeout, signal, kill, and wrapper-specific failures.
  - Validate stop taxonomy end-to-end.
- Notes:
  - Partial mitigation exists in current backend timeout classification tests.

### LOOP-OPS-011 — Progress line schema stability
- Status: watching
- Problem: Progress lines now exist and include timestamps, but the schema is still implicit.
- Why it matters: Cron/reporting/watch tooling should not depend on accidental string shape.
- Proposed improvement:
  - Document and freeze a stable progress schema.
  - Consider optional machine-readable output mode for operator tools.

### LOOP-OPS-012 — Preset-aware supervision policy
- Status: open
- Problem: Different presets have different healthy runtime shapes, but supervision policy is still mostly generic.
- Why it matters: autospec, autocode, autosimplify, and autoqa should not all be judged by the same rhythm.
- Proposed improvement:
  - Add preset-specific expectations for iteration cadence, artifact deltas, and acceptable stop reasons.

### LOOP-OPS-013 — Chain/branch visibility in operator surfaces
- Status: open
- Problem: Parent/child relationships across chain runs and parallel branches are hard to see at a glance.
- Why it matters: Without lineage visibility, multi-run orchestration becomes opaque fast.
- Proposed improvement:
  - Add lineage fields and operator views for parent run, child runs, branch ids, and join state.

### LOOP-OPS-014 — Supervisor-safe completion policy
- Status: open
- Problem: A loop can complete while still leaving ambiguity about whether the requested slice was fully delivered.
- Why it matters: `loop.complete` is necessary but not always sufficient for operator trust.
- Proposed improvement:
  - Require clearer completion summaries and completion-evidence checks in supervisor flows.

### LOOP-OPS-015 — Daily operational analytics
- Status: open
- Problem: We have basic preset timing summaries, but not a durable operational analytics view for interventions, relaunches, and stuck rates.
- Why it matters: If we want to manage loops well, we need to see where operations overhead accumulates.
- Proposed improvement:
  - Track intervention counts, relaunch rates, stuck-loop frequency, and supervisor success rate by preset.

---

## Recently mitigated

### LOOP-OPS-016 — Concise stdout progress lines
- Status: done
- Problem: Parent process stdout was too quiet for useful monitoring.
- Improvement delivered:
  - Added concise `[progress]` lines for continue, completion, rejection, parallel, and stop outcomes.
  - Added ISO timestamps.

### LOOP-OPS-017 — Stop-path progress visibility
- Status: done
- Problem: Failures and max-iteration stops did not emit concise operator-facing progress lines.
- Improvement delivered:
  - Added progress lines for `stop:max_iterations`, `stop:backend_failed`, and `stop:backend_timeout`.

### LOOP-OPS-018 — Wrapped timeout misclassification
- Status: done
- Problem: Wrapped backend timeouts could be mislabeled as generic backend failure.
- Improvement delivered:
  - Hardened timeout classification in the backend runner.
  - Added unit/integration coverage.
