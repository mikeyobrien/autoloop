# Context: Separate example preset dirs from CWD working directory

## Request summary
Move examples so they run from CWD instead of their own directory. Examples should be "presets" that provide config (topology, roles, harness) but journal/memory/state lives in the CWD. Multiple examples share the same CWD state when run from the same directory.

## Current architecture
- `project_dir` is used for BOTH config loading AND state storage
- When running `bin/miniloops examples/autocode "prompt"`:
  - Config loads from `examples/autocode/miniloops.toml`, `topology.toml`, `harness.md`, `roles/`
  - State goes to `examples/autocode/.miniloops/` (journal, memory, tool scripts)
  - The generated emit tool sets `MINILOOPS_PROJECT_DIR='examples/autocode'`

## Desired architecture
- Separate "config dir" (example preset) from "work dir" (CWD)
- Config (miniloops.toml, topology.toml, harness.md, roles/) loads from the example dir
- State (.miniloops/, journal, memory) lives in CWD (".")
- The emit tool sets `MINILOOPS_PROJECT_DIR='.'`

## Key files
- `src/main.tn` — CLI dispatch, `parse_run_args`, `resolve_runtime_project_dir`
- `src/harness.tn` — `build_loop_context`, `reload_loop`, `install_runtime_tools`, `emit_tool_script`
- `src/config.tn` — `load_project`, `resolve_journal_file`, `resolve_memory_file`
- `src/topology.tn` — `load(project_dir)`

## Constraints
- Examples must remain self-contained preset directories (don't merge them into root)
- CWD state paths use the root miniloops.toml defaults for state_dir/journal/memory
- Config values (backend, event_loop, review, harness, memory budget) come from the example's miniloops.toml
- The emit tool and pi-adapter scripts must resolve state relative to CWD

## Acceptance criteria
1. `bin/miniloops examples/autocode "prompt"` loads config from examples/autocode/ but writes state to `./.miniloops/`
2. Multiple examples share journal/memory when run from the same CWD
3. All existing functionality (emit, inspect, memory commands) works with the new layout
