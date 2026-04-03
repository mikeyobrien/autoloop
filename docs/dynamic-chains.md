# Dynamic Chain Generation

## Overview

Dynamic chain generation allows a meta-level orchestrator (an LLM agent) to create and execute preset chains at runtime. This enables bounded open-ended execution — a long-lived sequence of inspectable, resumable chain episodes with explicit budgets, lineage, and quality gates.

**"Open-ended" means bounded autonomous episodes, not literal unbounded recursion.**

## Three orchestration layers

| Layer | Config | Scope |
|-------|--------|-------|
| **Topology** | `topology.toml` | Intra-loop role routing (planner → builder → critic → finalizer) |
| **Chains** | `chains.toml` / `--chain` | Inter-loop preset composition (autocode → autoqa → autoresearch) |
| **Dynamic chains** | Runtime chain specs | Meta-level chain planning, selection, and spawning |

## Budget model

Every dynamic chain session is constrained by explicit budgets configured in `chains.toml`:

```toml
[budget]
max_depth = 5                    # max nested chain depth
max_steps = 50                   # max total steps across all chains
max_runtime_ms = 3600000         # wall clock limit (1 hour)
max_children = 10                # max descendant chains
max_consecutive_failures = 3     # stop after N no-op/failed chains
```

Defaults apply if `[budget]` is not specified.

## Quality gates

Before spawning a new chain, the system checks:
1. Budget constraints (depth, steps, children, failures)
2. Quality gate: if the last 2+ chains ended in failure, spawning is blocked until the agent consolidates

This prevents unjustified runaway chain creation.

## Dynamic chain specs

Dynamic chain specs are durable JSON files stored in `.autoloop/chains/specs/`:

```json
{"chain_id": "dyn-1", "parent_id": "chain-2", "steps": "autocode,autoqa", "justification": "Code changes need validation"}
```

Each spec records:
- `chain_id` — unique identifier
- `parent_id` — lineage (which chain spawned this one)
- `steps` — preset sequence
- `justification` — why this chain was created

## Lineage tracking

Every dynamic chain records its parent chain ID. This creates an inspectable ancestry tree:
- `chain-1` (root)
  - `dyn-1` (spawned by chain-1)
    - `dyn-2` (spawned by dyn-1)

Lineage is visible in the journal via `chain.spawn` events and in spec files.

## Preset vocabulary constraint

Dynamic chains are constrained to known presets: autocode, autosimplify, autoideas, autoresearch, autoqa, autotest, autofix, autoreview, autodoc, autosec, autoperf.

The `validate_preset_vocabulary` function rejects unknown preset names.

## Agent interaction

Agents can emit `chain.spawn` coordination events to request dynamic chain creation. The harness passes these through without affecting topology routing.

## Inspection

```bash
autoloops inspect chain --format md    # see all chain runs including dynamic
```

Chain spec files are readable at `.autoloop/chains/specs/*.json`.

## Design principles

- Durable data over ephemeral prompts — chain specs persist as files
- Budget-first — every chain episode has hard limits
- Inspectable from disk — journal events, spec files, handoff/result artifacts
- No giant scheduler — the meta-orchestrator is just an LLM with chain tools
- Bounded episodes — resumable autonomous sessions, not infinite loops
