# Context: Implement Remaining .agents/tasks

## Request summary
Implement the 3 remaining code-task specs from `.agents/tasks/tonic-loops/`:
1. **journal-first-runtime-simplification** — Push coordination state into JSONL journal
2. **first-class-loop-chaining** — Add `chains.toml` and CLI chain composition
3. **dynamic-chain-generation** — Add bounded open-ended chain generation (depends on #2)

## Execution order
journal-first → loop-chaining → dynamic-chains

## Source type
Task specs in `.agents/tasks/tonic-loops/`

## Core engine (Tonic source)
| File | Role | Lines |
|------|------|-------|
| `src/harness.tn` | Main event loop, journal append, prompt rendering, scratchpad | ~1615 |
| `src/main.tn` | CLI dispatch (run, emit, inspect, memory, pi-adapter) | ~414 |
| `src/config.tn` | Config file loading (TOML/INI) | ~189 |
| `src/topology.tn` | Topology parsing, role/handoff management | ~362 |
| `src/memory.tn` | Memory JSONL store (learnings, preferences, meta) | ~339 |
| `src/pi_adapter.tn` | Pi backend integration | ~300 |

## Key patterns
- Journal events: `append_event(journal_file, run_id, iteration, topic, fields_json)`
- JSON encoding: `json_field(key, value)` for strings, `json_field_raw(key, raw)` for booleans
- Inspect surfaces: scratchpad, prompt, output, journal, memory
- All state in `.miniloops/` directory (journal.jsonl, memory.jsonl, pi-stream.*.jsonl)
- Config: flat `key = value` in miniloops.toml, TOML-like arrays `[...]`
- Topology: `[[role]]` sections + `[handoff]` map in topology.toml

## Constraints
- Follow repo tenets in AGENTS.md (12 principles)
- No giant frameworks — keep core narrow
- Validate with `tonic check .` after each slice
- Preserve existing test suite
