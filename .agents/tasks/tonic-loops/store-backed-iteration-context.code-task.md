# Task: Store-Backed Iteration Context

## Description
Use the tonic stdlib `Store` module for in-memory iteration state (current role, recent event, iteration number, run ID) to reduce redundant file re-reads and environment variable round-trips during a single autoloops run.

## Background
During each iteration, autoloops re-reads config, topology, journal, and memory files to reconstruct state. While `reload_loop()` is intentional for hot-reload support, some state is immutable within a run (run_id, self_command, project_dir) and other state only changes at well-defined points (iteration number increments, recent_event updates on emit). Currently this state is threaded through function arguments or reconstructed from environment variables.

The tonic stdlib now includes a `Store` module providing an in-memory key-value store. Using Store for run-scoped state eliminates redundant parsing while keeping hot-reloadable state (config, topology) on the file-read path.

## Reference Documentation
**Required:**
- `src/harness.tn` — iteration loop, `reload_loop`, state threading through `loop` map, environment variable exports
- Tonic stdlib Store module:
  - `Store.new() -> string` — create store, returns opaque ID
  - `Store.put(store, key, value) -> :ok` — set key-value
  - `Store.get(store, key) -> any` — get value (nil if missing)
  - `Store.get(store, key, default) -> any` — get with default
  - `Store.delete(store, key) -> :ok` — remove key
  - `Store.has_key?(store, key) -> bool`
  - `Store.keys(store) -> list`
  - `Store.drop(store) -> :ok` — destroy store
  - Global state, keyed by string IDs
  - Operations on dropped stores raise error

**Additional References:**
- `src/main.tn` — run entry point, option parsing
- `src/config.tn` — config loading

## Technical Requirements
1. Create a run-scoped Store at the start of `LoopHarness.run()` via `Store.new()`. Store the ID in the `loop` state map as `loop.store`.
2. Populate immutable run state into the store at initialization:
   - `"run_id"` — the generated run ID
   - `"project_dir"` — project directory path
   - `"self_command"` — the autoloops binary path
   - `"max_iterations"` — from config
   - `"completion_event"` — from config/topology
   - `"completion_promise"` — from config
3. Update mutable state in the store at well-defined points:
   - `"iteration"` — incremented at start of each `run_iteration`
   - `"recent_event"` — updated in `finish_iteration` after emit validation
   - `"recent_role"` — updated when backend runs
   - `"seen_events"` — accumulated list, updated on valid emit
4. Replace environment-variable-based state reads within a single run with `Store.get(store, key)` where the store is accessible.
5. Keep `runtime_env_lines()` and the emit tool script unchanged — they export to child processes that cannot access the in-process Store. The Store is for internal harness use only.
6. Call `Store.drop(store)` at run completion (in `complete_loop` and all `stop_*` paths) to clean up.
7. Do not remove `reload_loop()` or file-based hot-reload. Config and topology must still re-read from disk. The Store only caches state that is computed from those reads, not the reads themselves.
8. Thread the store ID through the loop map so all harness functions can access it without changing their signatures.

## Acceptance Criteria
- All existing harness behavior is preserved — iteration loop, emit validation, completion detection work identically.
- `Store.drop` is called on every exit path (normal completion, timeout, backend failure, max iterations).
- No new file reads or environment variable reads are introduced.
- The Store is internal to the harness — child processes (backend, emit tool) still use environment variables.

## Dependencies
- Tonic runtime with Store module available in stdlib
- Existing harness iteration loop and state management
