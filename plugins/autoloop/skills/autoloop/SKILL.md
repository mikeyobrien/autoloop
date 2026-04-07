---
name: autoloop
description: Run and operate autoloops — start runs, monitor progress, inject guidance, manage worktrees, inspect artifacts, and clean up. Use when the user asks to run an autoloop, check loop status, merge/clean worktrees, or operate on runs.
argument-hint: [run|status|guide|merge|clean|inspect] [args...]
---

# Autoloop Operations

You are operating the **autoloop** CLI to manage autonomous coding loops. Parse `$ARGUMENTS` to determine the operation. If no arguments or ambiguous, ask what the user needs.

## Operations

### Start a Run

```bash
# Basic run with a preset
autoloop run <preset> "objective"

# Run in isolated worktree (recommended for code changes)
autoloop run <preset> "objective" --worktree

# Auto-merge worktree on completion
autoloop run <preset> "objective" --worktree --automerge

# Run a chain of presets in sequence
autoloop run --chain autocode,autoqa "objective" --worktree
```

**Presets:** autocode, autofix, autotest, autoqa, autoreview, autosimplify, autodoc, autosec, autoperf, autospec, autoresearch, autoideas, autopr, automerge

**When to use `--worktree`:** Always for code-modifying presets (autocode, autofix, autosimplify, autoperf). Optional for read-only presets (autoreview, autoideas, autosec).

**When to use `--automerge`:** When the user wants hands-off operation. Appends an automerge step that squash-merges on completion.

**Backend override:** Use `-b claude` or `-b pi` or `-b kiro` to switch backends.

Use `run_in_background: true` on the Bash tool when starting runs so the user isn't blocked.

### Check Status

```bash
# List active runs
autoloop loops

# List all runs (including completed/failed)
autoloop loops --all

# Show details for a specific run (supports prefix match)
autoloop loops show <run-id>

# Watch a run live (polls every 2s, exits on completion)
autoloop loops watch <run-id>

# Health summary (stuck/watching/failed runs)
autoloop loops health
autoloop loops health --verbose
```

When the user asks "how's it going" or "status" with no specifics, run `autoloop loops` first. If there's one active run, follow up with `autoloop loops show <run-id>`.

### Inject Guidance

Send a message to a running loop. It appears once in the next iteration's prompt as `## OPERATOR GUIDANCE`, then is consumed.

```bash
# Guide the latest active run
autoloop guide "Focus on error handling"

# Guide a specific run
autoloop guide --run <run-id> "Skip the auth module, focus on payments"
```

Use this when the user wants to steer a running loop without killing it.

### Inspect Artifacts

```bash
# View the scratchpad (iteration-by-iteration summary)
autoloop inspect scratchpad

# View the prompt sent to backend for a specific iteration
autoloop inspect prompt <iteration> --format md

# View raw backend output for an iteration
autoloop inspect output <iteration>

# View coordination events
autoloop inspect coordination

# View topology (role routing graph)
autoloop inspect topology --format graph

# View metrics
autoloop inspect metrics --format terminal

# View memory
autoloop inspect memory

# All inspect commands support --run <run-id> for specific runs
```

### Manage Worktrees

Worktrees provide git-level isolation. Each `--worktree` run gets its own branch (`autoloop/<run-id>`).

#### List Worktrees
```bash
autoloop worktree list
```
Shows: run ID, status, branch, base branch, merge strategy, created time. Orphaned worktrees (disk path missing) show `(orphan)`.

#### Merge a Worktree
```bash
# Merge with recorded strategy (default: squash)
autoloop worktree merge <run-id>

# Override merge strategy
autoloop worktree merge <run-id> --strategy squash   # squash commits into one
autoloop worktree merge <run-id> --strategy merge    # merge commit (no squash)
autoloop worktree merge <run-id> --strategy rebase   # rebase onto base
```

If merge conflicts occur, the command aborts the merge, lists conflicting files, and exits non-zero. The user must resolve manually with `git merge <branch>` from the base branch.

#### Clean Up Worktrees

```bash
# Clean orphaned + terminal (merged/failed/removed) worktrees
autoloop worktree clean

# Clean ALL worktrees including running ones
autoloop worktree clean --all

# Force-clean a specific run's worktree
autoloop worktree clean --force <run-id>
```

**What gets cleaned:**
- `git worktree remove` (or force-delete the directory)
- `git branch -d/-D` to delete the branch
- Metadata directory removed

**What's skipped by default:** Running worktrees are skipped unless `--all` or `--force` is used.

#### Clean Up Run Directories

```bash
# Remove stale run directories older than 7 days
autoloop runs clean

# Custom age threshold
autoloop runs clean --max-age 30
```

### Worktree Lifecycle

1. **Created** on `autoloop run --worktree`: branch `autoloop/<run-id>`, dir `.autoloop/worktrees/<run-id>/tree/`
2. **Running**: loop executes, commits land on worktree branch
3. **Completed**: run finishes, worktree sits ready for merge
4. **Merged**: `autoloop worktree merge <run-id>` squashes into base branch
5. **Cleaned**: `autoloop worktree clean` removes directory, branch, and metadata

**Routine maintenance pattern:**
```bash
# After reviewing and merging completed worktrees:
autoloop worktree clean
# Periodically clean old run state:
autoloop runs clean --max-age 14
```

### Dashboard

```bash
# Start the web dashboard (default: http://127.0.0.1:4800)
autoloop dashboard

# Custom port/host
autoloop dashboard -p 3000 --host 0.0.0.0
```

### Configuration

```bash
# Show resolved config with provenance
autoloop config show

# Show as JSON
autoloop config show --json

# Show config file path
autoloop config path
```

### Memory & Tasks

```bash
# Memory operations
autoloop memory list
autoloop memory status
autoloop memory find "pattern"
autoloop memory add learning "insight"
autoloop memory remove <id>

# Task operations
autoloop task list
autoloop task add "description"
autoloop task complete <id>
```

## Decision Guide

| User wants to... | Command |
|---|---|
| Implement a feature | `autoloop run autocode "..." --worktree` |
| Fix a bug | `autoloop run autofix "..." --worktree` |
| Write tests | `autoloop run autotest "..." --worktree` |
| Review code | `autoloop run autoreview "..."` |
| Security audit | `autoloop run autosec "..."` |
| Write docs | `autoloop run autodoc "..." --worktree` |
| Check what's running | `autoloop loops` |
| Steer a running loop | `autoloop guide "..."` |
| See what a loop did | `autoloop inspect scratchpad` |
| Merge finished work | `autoloop worktree merge <id>` |
| Clean up | `autoloop worktree clean && autoloop runs clean` |
| Full hands-off | `autoloop run autocode "..." --worktree --automerge` |
