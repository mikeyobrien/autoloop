# Plan: Implement Remaining .agents/tasks

Three tasks in dependency order. Each task is broken into small verifiable slices.

## Task 1 — Journal-First Runtime Simplification

### Slice 1.1 — Add structured coordination event types to harness

Add new journal event topics that agents can emit for coordination state:
- `issue.discovered` — fields: id, summary, disposition, owner
- `issue.resolved` — fields: id, resolution
- `slice.started` — fields: id, description
- `slice.verified` — fields: id, method
- `slice.committed` — fields: id, commit_hash
- `context.archived` — fields: source_file, dest_file, reason

These are agent-emittable events that pass through the existing emit path. Mark them as non-routing system topics so they don't affect topology routing.

**Files:** `src/harness.tn`

### Slice 1.2 — Add coordination projection (inspect coordination)

Add `render_coordination(project_dir)` that reads journal lines, collects coordination events, and materializes a structured summary showing current issues, slice lifecycle, and commits. Wire into `dispatch_inspect` via `miniloops inspect coordination --format md`.

**Files:** `src/harness.tn`, `src/main.tn`

### Slice 1.3 — Update prompts and docs

Update `harness.md`, role prompts, and `AGENTS.md` to document the journal/markdown/docs/memory split. Add coordination event usage guidance to harness instructions.

**Files:** `harness.md`, `AGENTS.md`, `roles/build.md`, `roles/verify.md`, `roles/finalizer.md`

### Slice 1.4 — Validate

Run `tonic check .`, verify existing tests pass.

---

## Task 2 — First-Class Loop Chaining

### Slice 2.1 — Add chains.toml parser (src/chains.tn)

New module for parsing chain definitions. Format:
```toml
[[chain]]
name = "code-and-qa"
steps = ["autocode", "autoqa"]
```

Preset resolution: name → `examples/<name>/` directory.

**Files:** `src/chains.tn` (new), `test/chains_test.tn` (new)

### Slice 2.2 — Add chain execution engine

`LoopChains.run()` that runs each preset in sequence with:
- Isolated state dirs: `.miniloops/chains/<chain-run-id>/step-<n>/`
- Handoff/result artifacts between steps
- Chain lifecycle journal events: `chain.start`, `chain.step.start`, `chain.step.finish`, `chain.complete`

**Files:** `src/chains.tn`, `src/harness.tn` (accept work_dir in run options)

### Slice 2.3 — CLI support for chains

- `miniloops run . --chain autocode,autoqa` (ad hoc)
- `miniloops chain run <name> [project]` (named)
- `miniloops chain list [project]`

**Files:** `src/main.tn`

### Slice 2.4 — Chain inspection and docs

Add `miniloops inspect chain --format md`. Update README with chain documentation.

**Files:** `src/main.tn`, `src/chains.tn`, `README.md`

### Slice 2.5 — Validate

Run `tonic check .`, verify tests.

---

## Task 3 — Dynamic Chain Generation

### Slice 3.1 — Chain budget model

Add budget config: max_depth, max_steps, max_runtime_ms, max_children, max_consecutive_failures. Stored in chains.toml `[budget]` section.

**Files:** `src/chains.tn`

### Slice 3.2 — Dynamic chain spec format

Durable JSON chain spec files in `.miniloops/chains/specs/`. LLM-writable, validated against known presets and budget limits.

**Files:** `src/chains.tn`

### Slice 3.3 — Chain lineage and quality gates

Parent/ancestry tracking. Quality gate: refuse spawn if last N chains were no-ops/failures.

**Files:** `src/chains.tn`

### Slice 3.4 — Meta-orchestrator emit path

Agents emit `chain.spawn` with chain spec payload. Harness validates and schedules.

**Files:** `src/harness.tn`, `src/chains.tn`

### Slice 3.5 — Docs and validation

Document bounded open-ended execution model. Run `tonic check .`.

**Files:** `README.md`, `docs/dynamic-chains.md` (new)

## Out of scope
- Parallel chain execution
- Plugin systems or heavy schedulers
- Changes to Pi adapter internals
- Modifying existing preset topologies
