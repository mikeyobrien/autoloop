# Plan: Separate preset config dir from CWD working dir

## Step 1 — Add work_dir to harness loop context
In `src/harness.tn`, modify `build_loop_context` to accept and propagate a `work_dir` (defaults to ".") alongside `project_dir`. State paths (state_dir, journal_file, memory_file, tool_path, pi_adapter_path) resolve relative to `work_dir`. Config/topology/harness/roles still load from `project_dir`.

## Step 2 — Thread work_dir through config resolution
In `src/config.tn`, add `resolve_journal_file_in` and `resolve_memory_file_in` that take a separate work_dir for path resolution while reading config from project_dir. Update callers in harness.tn.

## Step 3 — Update emit tool script to use work_dir
In `src/harness.tn` `emit_tool_script`, set `MINILOOPS_PROJECT_DIR` to work_dir instead of project_dir. The emit tool dispatches state operations against CWD.

## Step 4 — Update main.tn CLI dispatch
In `src/main.tn`, pass work_dir="." through `dispatch` to `LoopHarness.run`. Keep `project_dir` as the example directory for config loading.

## Step 5 — Update emit and inspect commands
Ensure `LoopHarness.emit`, `render_scratchpad`, `render_prompt`, `render_output`, `render_journal` use work_dir for state file resolution.

## Step 6 — Verify
Run with an example preset and confirm state goes to CWD's .miniloops/, config loads from the example dir.
