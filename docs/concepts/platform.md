# autoloop as Control Plane

autoloop is the execution engine and state model for long-horizon autonomous work. External interfaces — CLI, chat, cron, future API/UI — are thin shells that launch, observe, and report on runs. They do not orchestrate.

## Architectural roles

### Control plane (autoloop)

- Runs multi-role event-driven loops
- Manages iteration limits, event routing, memory, and completion detection
- Owns the journal (append-only JSONL) as the canonical source of truth
- Emits structured launch metadata for every run
- Enforces topology constraints and quality gates

### Presets (product surface)

- Self-contained workflow definitions: topology, roles, harness instructions, config
- Each preset answers "what does this loop do?" with a clear behavioral center
- Enumerable, validatable, composable via chains
- See [auto-workflows.md](../guides/auto-workflows.md) for the full taxonomy

### Journals and artifacts (state model)

- Append-only JSONL journal records every event: loop start, iteration progress, agent emissions, completion
- Launch metadata in the `loop.start` event provides identity, lineage, and trigger context
- Artifacts (scratchpad, memory, metrics, coordination) are projections derived from the journal
- Future registry and analytics are also journal-derived — never a competing source of truth

### External shells (intake and observation)

| Shell | Role |
|-------|------|
| **CLI** | Launch runs, inspect artifacts, manage memory and chains |
| **Chat** | Thin intake: accept objectives, dispatch to autoloop, report results |
| **Cron** | Scheduled launch and exception-focused monitoring |
| **API/UI** | Future: same launch contract and registry queries as CLI |

External shells should get thinner over time as the control plane surface grows. If you find orchestration logic migrating into a shell, it belongs in a preset or in the harness instead.

## When to use autoloop

Use autoloop when the task is:

- **Iterative** — multiple passes with feedback between roles
- **Quality-sensitive** — requires review gates, verification, or structured critique
- **Longer than one-shot** — benefits from journaling, memory, and resumability
- **Worth inspecting** — operators need to answer "what happened and why?"

## When not to use autoloop

- Trivial deterministic tasks that a single script handles (run a formatter, deploy a known-good artifact)
- One-shot queries that need no iteration, state, or review
- Tasks where loop overhead exceeds the value of structured execution

## Anti-goals

- autoloop should not become a kitchen sink for every automated task
- Do not build a second orchestrator in chat code, cron code, or external tooling
- Do not replace the journal with a competing state store
- Do not introduce recursive loop-on-loop orchestration without bounded lineage and policy

## Run identity and metadata

Every run carries structured launch metadata in its `loop.start` journal event:

| Field | Description |
|-------|-------------|
| `run_id` | Unique identifier for this run |
| `preset` | Name of the preset driving this run |
| `objective` | The task objective (prompt) |
| `project_dir` | Preset/project directory |
| `work_dir` | Working directory for state and artifacts |
| `created_at` | ISO 8601 timestamp of run start |
| `backend` | Backend command used for this run |
| `trigger` | How the run was launched: `cli`, `chain`, `branch` |
| `parent_run_id` | Parent run ID for chain steps and branch children (empty for top-level runs) |

This metadata is sufficient for future registry indexing, lifecycle tracking, and lineage queries without external context.

## Design principles

1. **Journal is canonical.** Registry, analytics, and dashboards are derived views. If they drift, rebuild from the journal.
2. **Presets are the product.** New workflows are preset directories, not code changes.
3. **Shells are thin.** CLI, chat, and cron dispatch to autoloop — they do not contain loop logic.
4. **Metadata travels with the run.** Every run is self-describing through its launch event.
5. **Fail closed.** Verifier and critic roles prefer explicit evidence over quiet approval.
