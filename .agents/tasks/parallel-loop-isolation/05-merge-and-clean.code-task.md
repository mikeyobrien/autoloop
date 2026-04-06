# Task 5: Worktree Merge and Cleanup

**RFC:** `docs/rfcs/parallel-loop-isolation.md` &sect;6, &sect;8
**New files:** `src/worktree/merge.ts`, `src/worktree/clean.ts`
**Estimated scope:** ~180 lines new
**Dependencies:** Task 3 (worktree meta)

## Objective

Implement `autoloop worktree merge` and `autoloop worktree clean` — the post-run lifecycle for worktree-backed runs.

## Steps

### 1. Create `src/worktree/merge.ts`

```typescript
export interface MergeOpts {
  mainStateDir: string;
  runId: string;
  strategy?: string;  // "squash" | "merge" | "rebase", default "squash"
}

export interface MergeResult {
  success: boolean;
  conflicts?: string[];   // list of conflicting files
  recoveryHint?: string;  // CLI command to resolve
}

export async function mergeWorktree(opts: MergeOpts): Promise<MergeResult>
```

Steps inside `mergeWorktree`:
1. Read meta.json; verify status is `completed` (reject `running`, `merged`)
2. Determine base branch from meta
3. Ensure we're on base branch (`git checkout <base>`)
4. Execute strategy:
   - `squash`: `git merge --squash <branch>` then `git commit -m "..."`
   - `merge`: `git merge --no-ff <branch>`
   - `rebase`: `git rebase <branch>`
5. On success: `updateStatus(metaDir, "merged")`
6. On conflict: `git merge --abort`, return conflict list from `git diff --name-only --diff-filter=U`

### 2. Create `src/worktree/clean.ts`

```typescript
export interface CleanOpts {
  mainStateDir: string;
  runId?: string;       // specific run, or all
  all?: boolean;        // include running worktrees
  force?: boolean;      // remove dirty worktrees
}

export async function cleanWorktrees(opts: CleanOpts): Promise<string[]>  // returns removed run IDs
```

Steps:
1. List `.autoloop/worktrees/*/meta.json`
2. If `runId` specified, filter to that one
3. If not `--all`, filter to `merged` | `failed` | `removed` status
4. For each:
   a. `git worktree remove <path>` (with `--force` if opts.force)
   b. `git branch -d autoloop/<run-id>` (with `-D` if opts.force)
   c. `updateStatus(metaDir, "removed")`
   d. Remove meta directory
5. Cross-reference `git worktree list` to detect orphans (meta present, path missing)

### 3. Stale run-scoped directory cleanup

Add to `src/isolation/run-scope.ts` (Task 2):

```typescript
export function cleanRunScopedDirs(baseStateDir: string, opts: {
  maxAgeDays?: number;  // default 7
  dryRun?: boolean;
}): string[]
```

Reads registry to find terminal runs, cross-references `runs/` directories, removes qualifying ones.

### Acceptance Criteria

- `mergeWorktree` with `squash` strategy produces a single squash commit on base branch.
- Merge conflicts are detected, merge is aborted, conflict files + recovery hint are returned.
- `cleanWorktrees` removes worktrees + branches + metadata for terminal runs.
- `--force` removes dirty worktrees.
- Orphan detection flags meta with missing path.
