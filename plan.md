# Plan: Implement pending tasks from .agents/tasks

## Priority Order (dependency-aware)

### Tier 1 — Foundational / No Dependencies
1. **Require Explicit Preset Argument** — safety, fail-closed CLI ← **FIRST SLICE**
2. **Access-Based Config** — nested map config via tonic `Access` module
3. **Compact Run ID Encoding** — shorter run IDs via base-36
4. **Store-Backed Iteration Context** — `Store` for in-memory state

### Tier 2 — Cross-Cutting
5. **Structured Logger** — replace ad-hoc verbose_log with `Logger`
6. **Regex Event Matching** — `/pattern/` support in topology routing
7. **CSV Metrics Export** — `inspect metrics --format csv`
8. **Preset Test Harness** — `.tn` test files for presets/topology

### Tier 3 — Restructuring
9. **First-Class Presets** — move `examples/` → `presets/`, CLI exposure
10. **Profiles for Preset Role Tuning** — append-only role fragments
11. **Isolate Standalone Loop State** — per-run work directory isolation

### Tier 4 — Advanced
12. **First-Class Loop Chaining** — separate chaining from topology, CLI composition
13. **Dynamic Chain Generation** — LLM-driven chain creation with budgets
14. **Journal-First Runtime** — push coordination into JSONL journal
15. **Auto Workflows Family** — native AutoQA, `auto*` family taxonomy
16. **Structured Parallelism** — bounded fan-out with event suffixes

## Current Slice
**Task:** Access-Based Config — nested map config with deep traversal
**Spec:** `.agents/tasks/tonic-loops/access-based-config.code-task.md`
**Status:** Scoped by planner, ready for builder.

### Deviation from Spec
The task spec assumes `Access.get_in`, `Access.put_in`, and `Toml.decode` exist in the tonic stdlib. They do NOT — verified via `tonic check`. Available `Map` functions: `delete, drop, filter, from_list, get, has_key, keys, merge, new, pop, put, put_new, reject, take, to_list, update, values`. No `Map.get_in` either.

**Adaptation:** Implement the traversal helpers (`get_in`, `put_in`, `deep_merge`) as private functions inside `LoopConfig`. Write a minimal TOML section parser (`parse_toml`) that handles `[section]` headers and builds nested maps. No external dependency needed.

### Build Steps (ordered)

1. **Add `get_in/3` helper** — recursive `Map.get` traversal over a list of keys. Private to `LoopConfig`.

2. **Add `put_in/3` helper** — recursive nested `Map.put` that creates intermediate maps. Private to `LoopConfig`.

3. **Add `deep_merge/2` helper** — merges two nested maps recursively (loaded config over defaults). Private to `LoopConfig`.

4. **Restructure `defaults/0`** — convert from flat `"event_loop.max_iterations" => "3"` to nested `%{"event_loop" => %{"max_iterations" => "3"}, ...}`.

5. **Add `parse_toml/1`** — line-by-line parser that recognizes `[section]` headers and produces nested maps. Falls back to existing flat parsing for `.conf` files.

6. **Update `load/1`** — detect `.toml` vs `.conf` extension. Use `parse_toml` for `.toml`, existing `parse_lines` for `.conf`. Deep-merge loaded config over nested defaults.

7. **Update `get/3`** — accept both dotted string `"event_loop.max_iterations"` (split on `.`, call `get_in`) and list path `["event_loop", "max_iterations"]` (call `get_in` directly).

8. **Update `get_int/3` and `get_list/2`** — route through the new `get/3`.

9. **Add `put/3`** — public function using `put_in` for programmatic config updates.

10. **Update `load_project/1`** — pass `resolve_config_path` result so `load` knows the extension.

11. **Update tests in `test/config_test.tn`** — existing tests should still pass (dotted string keys). Add tests for list-path access and nested TOML section loading.

12. **Verify** — `tonic check .`, `tonic test`, and manual smoke test with existing `miniloops.toml`.

### Call-site note
All ~30 call sites in `harness.tn`, `main.tn`, `topology.tn`, `chains.tn`, `memory.tn` use dotted-string keys like `LoopConfig.get(config, "event_loop.max_iterations", "3")`. These will continue to work because the updated `get/3` splits dotted strings into paths. No call-site changes needed.

### Risk
- Existing `miniloops.toml` files use flat `event_loop.max_iterations = 100` format (not `[event_loop]` sections). The TOML parser must handle both: bare dotted keys go into nested structure, and `[section]` headers also work.
- Values with `=` signs in them (unlikely but possible) — the existing parser already handles multi-`=` lines via `rejoin`.

## Completed Slices
1. ~~Require Explicit Preset Argument~~ — `649ff3e` ✓
