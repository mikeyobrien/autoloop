<!-- category: planning -->

This preset merges a completed worktree branch back into its base branch.

It runs in the main tree (not a worktree) and should never trigger worktree isolation itself.

Instructions:
1. Read `handoff.md` in the current work directory. The `## Parent Run` section contains `parent_run_id: <id>`.
2. Execute `autoloop worktree merge <parent-run-id>` to merge the worktree.
3. Report success or failure via the completion event.
