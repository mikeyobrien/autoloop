# Documentation Audit — doc-plan.md

## Existing docs inventory

| File | Covers | Status |
|------|--------|--------|
| `README.md` | Overview, workflow family table, chaining, config, topology, journal, event tool, projections, run commands, install | Current — comprehensive but serves as a reference landing page |
| `docs/auto-workflows.md` | Full taxonomy of 10 auto* presets, naming guidance, chooser table | Current |
| `docs/dynamic-chains.md` | Dynamic chain generation, budgets, quality gates, lineage, specs | Current |

## Gaps found (no existing docs/ coverage)

### Gap 1: Topology reference
**What:** `topology.toml` format, fields, handoff map semantics, advisory routing model, role deck structure, how completion event is derived from topology vs config.
**Source:** `src/topology.tn`, `topology.toml`, README topology section (brief).
**Priority:** High — core concept with no standalone doc.

### Gap 2: Configuration reference
**What:** Full `miniloops.toml` key reference — all keys, types, defaults, precedence (toml > conf), sections (event_loop, backend, review, memory, harness, core). Includes backend override `-b` flag.
**Priority:** High — operators need this to tune loops.

### Gap 3: Journal and runtime model
**What:** Journal-first architecture — event types, field schemas, JSONL format, journal lifecycle (loop.start → iteration.start → backend.start → agent events → backend.finish → iteration.finish → loop.complete), coordination events, review events, chain events. Scratchpad projection. Raw Pi stream logs.
**Priority:** High — foundational concept referenced everywhere but no dedicated doc.

### Gap 4: Memory system
**What:** Loop memory — JSONL format, entry types (learning, preference, meta, tombstone), materialization (dedup, tombstone removal), prompt budget, CLI commands (add/remove/list).
**Priority:** Medium — covered briefly in README, needs standalone reference.

### Gap 5: Hyperagent review loop
**What:** Meta-level review pass — cadence, review prompt construction, what the hyperagent does (consolidation, hygiene), `hyperagent.md` role, review config keys, review journal events.
**Priority:** Medium — mentioned in README but no standalone doc.

### Gap 6: CLI reference
**What:** All CLI commands and subcommands — `run`, `emit`, `inspect` (all artifacts), `memory` (add/remove/list), `chain` (run/list), `pi-adapter`. Flags: `-b`/`--backend`, `--chain`, `-v`/`--verbose`. `bin/miniloops` launcher. `tonic run` vs `miniloops` invocation.
**Priority:** High — users need a single place to look up commands.

### Gap 7: Backpressure and event validation
**What:** Soft routing + protocol backpressure — how allowed events are derived, what happens on hallucinated events, `event.invalid` journal entries, re-prompting with routing context.
**Priority:** Low — covered in README, could be a section in the journal doc.

### Gap 8: LLM judge script
**What:** `scripts/llm-judge.sh` — usage, criteria/content args, JSON output, exit codes, pi dependency.
**Priority:** Low — small utility, brief doc suffices.

### Gap 9: Creating a custom preset/workflow
**What:** How to create a new auto* preset from scratch — directory structure (harness.md, topology.toml, roles/*.md, miniloops.toml), naming convention, registering in chains.toml.
**Priority:** Medium — useful for users extending the family.

## Prioritized write order

1. `docs/topology.md` — Topology reference (Gap 1)
2. `docs/configuration.md` — Configuration reference (Gap 2)
3. `docs/journal.md` — Journal and runtime model (Gap 3)
4. `docs/memory.md` — Memory system (Gap 4)
5. `docs/cli.md` — CLI reference (Gap 6)
6. `docs/hyperagent.md` — Hyperagent review loop (Gap 5)
7. `docs/creating-presets.md` — Creating custom presets (Gap 9)
8. `docs/llm-judge.md` — LLM judge script (Gap 8)

Note: Gap 7 (backpressure) will be a section in `docs/journal.md` rather than a standalone doc.
