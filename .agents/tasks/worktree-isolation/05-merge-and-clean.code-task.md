# Task 5: Merge and Cleanup Modules

**RFC:** `docs/rfcs/worktree-isolation.md` §7, §8
**New files:** `src/worktree/merge.ts`, `src/worktree/clean.ts`
**Depends on:** Task 1 (meta.ts)
**Estimated scope:** ~150 lines

## Objective

Implement the merge and cleanup logic for worktree runs.

## Steps

### 1. Create `src/worktree/merge.ts`

```typescript
export interface MergeResult {
  success: boolean;
  strategy: string;
  conflictFiles?: string[];  // populated on conflict
  error?: string;
}

export function mergeWorktree(opts: {
  mainProjectDir: string;
  metaDir: string;
  strategy?: string;  // override meta.merge_strategy
}): MergeResult
```

Implementation:
1. Read `meta.json` via `readMeta()`. Fail if status is not `"completed"` — print: `"Run ${run_id} is ${status}; only completed runs can be merged."`.
2. Determine strategy: `opts.strategy ?? meta.merge_strategy`.
3. From `mainProjectDir`, switch to `meta.base_branch`: `git checkout <base_branch>`.
4. Execute merge by strategy:
   - **squash**: `git merge --squash <branch>` then `git commit -m "autoloop: merge <run_id> (squash)"`.
   - **merge**: `git merge --no-ff <branch> -m "autoloop: merge <run_id>"`.
   - **rebase**: `git rebase <branch>`.
5. On success: `updateStatus(metaDir, "merged")`. Return `{ success: true, strategy }`.
6. On conflict (non-zero exit from git): parse `git diff --name-only --diff-filter=U` for conflicting files. Abort: `git merge --abort` (or `git rebase --abort`). Return `{ success: false, strategy, conflictFiles }`. Print recovery instructions:
   ```
   Merge conflict. Conflicting files:
     - src/foo.ts
     - src/bar.ts
   
   To resolve manually:
     cd <worktree_path>
     git merge --abort   # to reset
   ```

### 2. Create `src/worktree/clean.ts`

```typescript
export function cleanWorktree(opts: {
  mainProjectDir: string;
  metaDir: string;
  force?: boolean;
}): void

export function cleanAllWorktrees(opts: {
  stateDir: string;
  mainProjectDir: string;
  all?: boolean;     // include running/completed (not just merged/failed)
  force?: boolean;
}): { cleaned: string[]; skipped: string[] }
```

`cleanWorktree` implementation:
1. Read `meta.json`. If status is `"running"` and not `force`, skip with warning.
2. `git worktree remove <worktree_path>` (add `--force` if `opts.force`).
3. `git branch -d <branch>` (use `-D` if `opts.force`).
4. `updateStatus(metaDir, "removed")`.
5. Remove the `metaDir` directory.

`cleanAllWorktrees` implementation:
1. Read all subdirectories of `<stateDir>/worktrees/`.
2. For each, read `meta.json` and determine eligibility:
   - Default (no flags): clean `merged` and `failed` worktrees.
   - `--all`: clean all statuses except `running` (unless `--force`).
   - `--force`: clean everything.
3. Call `cleanWorktree` for each eligible entry. Collect results.

### Acceptance criteria

- `mergeWorktree()` performs squash/merge/rebase correctly against the base branch.
- Conflicts are detected, merge is aborted, and recovery instructions are printed.
- Only `completed` runs can be merged.
- `cleanWorktree()` removes the worktree, branch, and metadata.
- `cleanAllWorktrees()` respects the `all`/`force` flags.
- Dirty worktrees are never deleted without `--force`.
