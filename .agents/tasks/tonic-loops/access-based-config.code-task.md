# Task: Access-Based Config Traversal

## Description
Replace the flat dotted-key config system in `src/config.tn` with nested map structure using the tonic stdlib `Access` module. Support real TOML section nesting so config keys like `[event_loop]` become nested maps rather than flat `"event_loop.max_iterations"` strings.

## Background
Miniloops config currently loads `miniloops.toml` (or `.conf`) into a flat map where keys like `"event_loop.max_iterations"` are plain strings mapped to string values. Lookups use `Map.get(config, "event_loop.max_iterations", default)`. This works but prevents real TOML section structure and makes nested config awkward.

The tonic stdlib now includes an `Access` module with `Access.get_in(data, path)` and `Access.put_in(data, path, value)` for traversing nested maps. Combined with tonic's existing `Toml.decode` which already produces nested maps, the config system can use real structure instead of flattened keys.

## Reference Documentation
**Required:**
- `src/config.tn` — `load_project`, `get`, `get_int`, `get_list`, defaults map, line-by-line parsing
- Tonic stdlib Access module:
  - `Access.get_in(data, path) -> any` — traverse nested structure with list of keys
  - `Access.put_in(data, path, value) -> map` — set value at nested path, creates intermediates
  - `Access.fetch(data, key) -> {:ok, value} | :error` — single-key access with error distinction
  - `Access.keys(map) -> list` — get all keys
  - Path is always a list of string keys for maps
  - Missing intermediate paths return nil
- Tonic stdlib `Toml.decode(string) -> map` — already produces nested maps from TOML sections

**Additional References:**
- `src/harness.tn` — all `LoopConfig.get()` call sites
- `src/main.tn` — config usage in CLI dispatch
- `src/topology.tn` — config usage
- `src/chains.tn` — config usage for budget loading

## Technical Requirements
1. Update `load_project` to use `Toml.decode` for `.toml` files, producing a nested map directly. Keep `.conf` fallback with flat parsing for backward compatibility.
2. Replace the flat defaults map with a nested defaults map:
   ```
   %{"event_loop" => %{"max_iterations" => "3", "completion_promise" => "LOOP_COMPLETE", ...},
     "backend" => %{"kind" => "pi", "command" => "pi", ...},
     "core" => %{"state_dir" => ".miniloop", ...}}
   ```
3. Update `get(config, key, fallback)` to accept either:
   - A dotted string `"event_loop.max_iterations"` (split on `.` and call `Access.get_in`)
   - A list path `["event_loop", "max_iterations"]` (call `Access.get_in` directly)
4. Update `get_int` and `get_list` to use the new `get` internally.
5. Merge loaded config over defaults using a deep merge so that partial TOML sections don't clobber entire default subsections.
6. Update all call sites in `harness.tn`, `main.tn`, `topology.tn`, `chains.tn`, and `memory.tn` to use dotted-string or list-path keys as appropriate. Prefer list paths in new code.
7. Add `put(config, key, value)` using `Access.put_in` for programmatic config updates (used by profile and chain systems).
8. Preserve backward compatibility: existing `miniloops.toml` files with flat `key = "value"` lines must still load correctly via the `.conf` fallback path.

## Acceptance Criteria
- `miniloops.toml` with `[event_loop]` TOML sections loads into nested maps.
- `LoopConfig.get(config, "event_loop.max_iterations", "3")` returns the correct value from nested structure.
- `LoopConfig.get(config, ["event_loop", "max_iterations"], "3")` also works.
- Flat `.conf` files continue to load and work.
- All existing harness, topology, and chain functionality works unchanged.
- Deep merge preserves defaults for unset keys within a section.

## Dependencies
- Tonic runtime with Access module and Toml.decode available in stdlib
- Must update all config call sites across src/*.tn files
