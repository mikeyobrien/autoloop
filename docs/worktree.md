# Worktree & Isolation

Autoloop isolates concurrent runs so they do not clobber each other's files. There are three isolation modes — **shared**, **run-scoped**, and **worktree** — selected automatically or via CLI flags.

## Isolation modes

| Mode | Working directory | State directory | Git branch | Best for |
|------|-------------------|-----------------|------------|----------|
| **shared** | Project root | `.autoloop/` | Current branch | Single runs, read-only tasks |
| **run-scoped** | Project root | `.autoloop/runs/<runId>/` | Current branch | Concurrent planning runs that don't modify code |
| **worktree** | `.autoloop/worktrees/<runId>/tree/` | `<worktree>/.autoloop/` | `autoloop/<runId>` | Concurrent code-modifying runs |

### Resolution order

Isolation mode is resolved by the first matching rule:

1. `--worktree` flag → **worktree**
2. `--no-worktree` flag → **shared**
3. Config `worktree.enabled = true` (or `isolation.enabled = true`) → **worktree**
4. No other active runs → **run-scoped**
5. Current preset is planning category → **run-scoped** (no warning)
6. Other code-modifying runs active → **run-scoped** + warning
7. Otherwise → **run-scoped**

When a code-modifying run starts while another code-modifying run is already active in the shared checkout, autoloop prints a warning to stderr suggesting `--worktree`.

### Preset categories

Each preset has a category that influences isolation decisions:

- **Code** presets (modify source): autocode, autofix, autotest, autosimplify, autoperf, autosec
- **Planning** presets (read-only): automerge, autoideas, autoresearch, autodoc, autoreview, autoqa, autospec

Categories are detected from a `<!-- category: code|planning|unknown -->` comment in the preset's `harness.md`, falling back to name-based heuristics.

## Worktree lifecycle

### 1. Creation

```bash
autoloop run autocode --worktree "implement feature X"
```

Creates a git worktree at `.autoloop/worktrees/<runId>/tree/` on a new branch `autoloop/<runId>`. The run executes entirely inside the worktree directory.

### 2. Execution

During the run, `status` in the worktree metadata is `running`. All state files (journal, tasks, memory) are written inside the worktree's own `.autoloop/` directory.

### 3. Completion

When the loop exits, the metadata status is updated to `completed` (success) or `failed`.

### 4. Merge

Merge manually or automatically:

```bash
# Manual merge
autoloop worktree merge <run-id>
autoloop worktree merge <run-id> --strategy rebase

# Auto-merge on completion
autoloop run autocode --worktree --automerge "fix the bug"
```

The merge checks out the base branch, applies changes using the configured strategy, and updates metadata to `merged`.

If conflicts occur, the merge aborts cleanly and returns the list of conflicting files with a recovery hint.

### 5. Cleanup

```bash
autoloop worktree clean              # Remove terminal (merged/failed/removed) worktrees
autoloop worktree clean <run-id>     # Remove specific worktree
autoloop worktree clean --all        # Include non-terminal worktrees
autoloop worktree clean --force      # Force-remove and delete branches with -D
```

Cleanup removes the git worktree, deletes the branch, and removes the metadata directory. Orphaned worktrees (metadata exists but directory is missing) are always eligible for cleanup.

## Merge strategies

| Strategy | Git command | Behavior |
|----------|-------------|----------|
| **squash** (default) | `git merge --squash` | All worktree commits collapsed into one commit on base branch |
| **merge** | `git merge --no-ff` | Standard merge commit preserving full history |
| **rebase** | `git rebase <branch>` | Worktree commits replayed on top of base branch |

### Git author resolution

Merge commits use the first available author identity:

1. `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` environment variables
2. `git config user.name` / `user.email`
3. `AUTOLOOP_GIT_NAME` / `AUTOLOOP_GIT_EMAIL` environment variables
4. Fallback: `autoloop` / `autoloop@local`

## CLI reference

### `autoloop run` flags

| Flag | Default | Description |
|------|---------|-------------|
| `--worktree` | off | Force worktree isolation |
| `--no-worktree` | off | Force shared checkout (suppress warning) |
| `--merge-strategy` | `squash` | Merge strategy: squash, merge, rebase |
| `--automerge` | off | Automatically merge worktree on successful completion |
| `--keep-worktree` | off | Preserve worktree directory after run ends |

### `autoloop worktree` subcommands

```
autoloop worktree [subcommand]
```

| Subcommand | Description |
|------------|-------------|
| `list` | List all worktree metadata (default if no subcommand) |
| `show <run-id>` | Show detailed metadata for a specific worktree |
| `merge <run-id> [--strategy <s>]` | Merge worktree into its base branch |
| `clean [--all] [--force] [<run-id>]` | Remove worktrees and clean up branches |

### `autoloop runs clean`

Cleans up run-scoped directories (not worktrees):

```bash
autoloop runs clean                  # Remove terminal runs older than 7 days
autoloop runs clean --max-age 30     # Custom age threshold in days
```

Active runs are never cleaned.

## Configuration

```toml
[worktree]
enabled = true               # Default to worktree isolation for all runs
branch_prefix = "autoloop"   # Branch name prefix (default: "autoloop")
merge_strategy = "squash"    # Default merge strategy (default: "squash")
cleanup = "on_success"       # Cleanup policy: "on_success" or "always"
```

The `[isolation]` section is an alias — `isolation.enabled = true` has the same effect as `worktree.enabled = true`.

## State files

Worktree metadata is stored at:

```
.autoloop/worktrees/<runId>/meta.json
```

The `meta.json` schema:

| Field | Type | Description |
|-------|------|-------------|
| `run_id` | string | Run identifier |
| `branch` | string | Git branch name (e.g. `autoloop/run-abc123`) |
| `worktree_path` | string | Absolute path to worktree directory |
| `base_branch` | string | Branch the worktree was created from |
| `status` | string | `running`, `completed`, `failed`, `merged`, or `removed` |
| `merge_strategy` | string | Configured merge strategy |
| `created_at` | string | ISO 8601 timestamp |
| `merged_at` | string \| null | Set when merged |
| `removed_at` | string \| null | Set when cleaned |

Run-scoped directories are stored at `.autoloop/runs/<runId>/` and contain per-run journal, tasks, and memory files.

## Chain behavior

When a chain step runs inside a worktree, planning-category steps suppress worktree isolation (they run with `--no-worktree` internally) since they don't modify code. Code-modifying steps inherit the parent's worktree settings.
