# Quick Start

## Run your first loop

```bash
# Run a bundled preset
autoloop run autocode "Fix the login bug"

# Inspect active and recent runs
autoloop loops

# Open the local dashboard
autoloop dashboard

# Keep an implementation pass isolated in a git worktree
autoloop run autocode --worktree --automerge "Implement the approved fix"
```

`autocode` is a bundled preset. The quoted string is the objective passed to the loop.

## The golden path

1. Start a loop with a preset
2. Watch it move through iterations
3. Inspect the journal, events, and artifacts
4. Open the dashboard when you want a higher-level operator view
5. Use worktree isolation when the loop is making risky repo changes

## Main commands

```
autoloop run <preset-name|preset-dir> [prompt...] [flags]
autoloop list
autoloop loops [--all]
autoloop inspect <artifact> [selector] [project-dir]
autoloop dashboard [--port <port>]
autoloop worktree <list|show|merge|clean> [args]
```

See the [CLI reference](/reference/cli) for the full command list and flags.
