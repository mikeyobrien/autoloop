<!-- category: planning -->

This preset merges a completed worktree branch back into its base branch.

It runs in the main tree (not a worktree) and should never trigger worktree isolation itself.

Instructions:
1. Read the parent run's worktree metadata from the chain handoff artifact.
2. Execute `autoloop worktree merge <parent-run-id>` to merge the worktree.
3. Report success or failure via the completion event.
