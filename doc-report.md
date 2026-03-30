# Documentation Report

## Published

### 1. `docs/topology.md` — Topology Reference
- **Status:** Published
- **Covers:** File format, top-level keys, role definitions, handoff map, routing model (suggested roles → allowed events → backpressure), prompt injection, default topology, completion resolution order, design patterns (linear pipeline, rejection loops, fan-back, blocked escalation), examples.
- **Verified:** All 13 claims checked against `src/topology.tn` and example topologies — no inaccuracies.

### 2. `docs/configuration.md` — Configuration Reference
- **Status:** Published
- **Covers:** Full `autoloops.toml` key reference — 6 sections (event_loop, backend, review, memory, harness, core), 26 keys total. Precedence chain, hot-reload behavior, prompt resolution order, review fallback-to-backend defaults, kind auto-detection, truthy parsing, mock backend mode, preset required-events table.
- **Verified:** 17 claims checked against `src/config.tn`, `src/harness.tn`, `src/pi_adapter.tn`, and all 10 example presets — no inaccuracies.

### 3. `docs/journal.md` — Journal and Runtime Model
- **Status:** Published
- **Covers:** Record shapes (system, agent, coordination events), event lifecycle, all event types (10 lifecycle, 7 coordination, 5 chain), backpressure and event validation (Gap 7 folded in), completion detection, scratchpad projection, run scoping, JSON encoding, CLI inspection commands.
- **Verified:** All claims checked against source. One minor fix applied: `loop.stop` fields corrected to note `iteration`/`output_tail` only present for `backend_failed`/`backend_timeout` variants. No other inaccuracies.

### 4. `docs/memory.md` — Memory System
- **Status:** Published
- **Covers:** JSONL file format, 4 entry types (learning, preference, meta, tombstone) with field schemas, ID generation, materialization algorithm (reverse-chronological dedup, tombstone handling, meta key dedup), prompt injection format with budget truncation, CLI commands (add learning/preference/meta, remove, list, inspect), configuration keys (`memory.prompt_budget_chars`, `core.memory_file`), environment variable export (`MINILOOPS_MEMORY_FILE`), JSON encoding table.
- **Verified:** All claims checked against `src/memory.tn`, `src/harness.tn`, `src/main.tn`, and `src/config.tn` — no inaccuracies.

### 5. `docs/cli.md` — CLI Reference
- **Status:** Published
- **Covers:** Two invocation forms (`autoloops` wrapper vs `tonic run`), 8 environment variables, all 6 subcommands: `run` (with `-b`, `-v`, `--chain` flags and project-dir auto-detection), `emit` (event validation and `event.invalid` behavior), `inspect` (7 artifacts with formats and selectors), `memory` (list/add learning/add preference/add meta/remove), `chain` (list/run), `pi-adapter` (prompt resolution chain, NDJSON parsing, stream log files). `bin/autoloops` launcher behavior.
- **Verified:** All claims checked against `src/main.tn`, `src/pi_adapter.tn`, `src/harness.tn`, `src/chains.tn`, and `bin/autoloops` — no inaccuracies.

### 6. `docs/metareview.md` — Metareview Review Loop
- **Status:** Published
- **Covers:** Scheduling formula (`iteration > 1 AND (iteration - 1) % review_every == 0`), default cadence derivation (role count from topology, fallback to 1), all 9 `review.*` config keys with defaults and fallbacks, prompt resolution chain (`review.prompt` → `review.prompt_file` → empty), built-in system prompt contents, `MINILOOPS_REVIEW_MODE=metareview` environment variable, disabled allowed-events during review, `review.start`/`review.finish` journal events with field schemas, pi-adapter stream log routing (`pi-review.<iter>.jsonl`), hot-reload after review.
- **Verified:** All 11 checklist claims checked against `src/harness.tn`, `src/pi_adapter.tn`, and `src/config.tn` — no inaccuracies.

### 7. `docs/creating-presets.md` — Creating Custom Presets
- **Status:** Published
- **Covers:** Directory structure, topology definition (handoff map, completion event, prompt_file paths), role prompt authoring patterns, harness instructions, loop configuration keys, running presets, chain registration, four design patterns from existing preset family (linear pipeline, rejection loop, blocked escalation, fan-back), naming conventions, pre-flight checklist.
- **Verified:** All 11 checklist claims checked against `src/topology.tn`, `src/chains.tn`, `src/config.tn`, example presets, and `docs/auto-workflows.md` — one fix applied (completion event precedence corrected), then re-verified with no remaining inaccuracies.

### 8. `docs/llm-judge.md` — LLM Judge Script
- **Status:** Published
- **Covers:** Two invocation forms (stdin pipe and second-argument), criteria as first positional arg, JSON output shape (`{"pass": bool, "reason": "..."}`), three exit codes (0 = pass, 1 = fail, 2 = judge error), internal pipeline (prompt → `pi --no-stream` → grep extraction), `pi` dependency, preset-relative path usage.
- **Verified:** All 8 checklist claims checked against `scripts/llm-judge.sh` and `examples/autoresearch/roles/evaluator.md` — no inaccuracies.

---

## Summary

All 8 documentation gaps identified in the audit have been written, verified, and published. The `docs/` directory now covers: topology, configuration, journal/runtime model, memory system, CLI reference, metareview review loop, creating custom presets, and the LLM judge script.
