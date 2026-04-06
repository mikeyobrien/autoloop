# Task 7: Automerge Preset

**RFC:** `docs/rfcs/worktree-isolation.md` §7 (Automerge Chain Step)
**New files:** `presets/automerge/autoloops.toml`, `presets/automerge/harness.md`
**Depends on:** Task 5 (merge.ts)
**Estimated scope:** ~40 lines

## Objective

Create a built-in `automerge` preset that can be chained after a worktree run to automatically merge the results.

## Steps

### 1. Create `presets/automerge/autoloops.toml`

```toml
[core]
state_dir = ".autoloop"

[event_loop]
max_iterations = 1
completion_promise = "LOOP_COMPLETE"

[backend]
command = "claude"
args = ["-p", "--dangerously-skip-permissions"]
prompt_mode = "arg"
```

The preset uses 1 iteration — the agent reads the parent run's worktree metadata and executes the merge.

### 2. Create `presets/automerge/harness.md`

Write harness instructions that tell the agent:
1. Read the parent run ID from the chain handoff artifact (passed via `parent_run_id` in `RunOptions`).
2. Locate `.autoloop/worktrees/<parent-run-id>/meta.json`.
3. If meta status is `completed`, execute merge using the configured strategy.
4. If meta status is not `completed`, report the status and emit a failure event.
5. Report the merge result (success or conflict details).
6. Emit the completion event.

Keep the instructions minimal — the agent calls the merge function, it doesn't implement git logic.

**Note:** The actual merge execution happens through the harness's tool system. The agent's role is to decide whether to merge and report results. The merge itself should be exposed as a callable tool or the harness should auto-execute it. For the initial implementation, the simplest approach is to have the harness instructions tell the agent to run the `autoloop worktree merge <parent-run-id>` CLI command via its shell tool.

### Acceptance criteria

- `autoloop run autocode --chain autocode,automerge --worktree "task"` chains correctly.
- The automerge step reads the parent run's worktree metadata.
- Merge executes with the configured strategy.
- Success/failure is reported as the step's completion.
- The preset is discoverable via `autoloop list`.
