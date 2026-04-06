# Task 2: Worktree Creation

**RFC:** `docs/rfcs/worktree-isolation.md` §3, §3a, §3b, §11
**New files:** `src/worktree/create.ts`
**Depends on:** Task 1 (meta.ts types)
**Estimated scope:** ~80 lines

## Objective

Implement the `createWorktree()` function that creates a git worktree and writes initial metadata.

## Steps

### 1. Create `src/worktree/create.ts`

```typescript
export interface CreateWorktreeResult {
  worktreePath: string;   // absolute path to the worktree root
  branch: string;         // e.g. "autoloop/run-abc12345"
  metaDir: string;        // path to .autoloop/worktrees/<run-id>/
}

export function createWorktree(opts: {
  mainProjectDir: string;   // cwd / main tree root
  stateDir: string;         // main tree's .autoloop/ dir
  runId: string;
  branchPrefix: string;     // default "autoloop"
  mergeStrategy: string;    // default "squash"
}): CreateWorktreeResult
```

Implementation:
1. Derive `branch = opts.branchPrefix + "/" + opts.runId`.
2. Derive `worktreePath = join(opts.stateDir, "worktrees", opts.runId)`.
3. **Safety check**: Run `git branch --list <branch>`. If it exists, throw with message: `"Branch '${branch}' already exists. Use a different run ID or remove the stale branch."`.
4. Run `git worktree add <worktreePath> -b <branch>` via `execSync` from `mainProjectDir` as cwd. Capture stderr. On failure, throw with the git error.
5. Derive `metaDir = metaDirForRun(opts.stateDir, opts.runId)` (from meta.ts).
6. Write initial `meta.json` via `writeMeta()`:
   - `status: "running"`, `base_branch`: detect via `git rev-parse --abbrev-ref HEAD`, `merged_at: null`, `removed_at: null`.
7. Return `{ worktreePath, branch, metaDir }`.

### 2. Gitignore verification

Add `ensureGitignoreEntry(projectDir: string)`:
- Read `.gitignore` in `projectDir`. If `.autoloop/` is not present as a line, append it.
- Call this at the start of `createWorktree`.

### Acceptance criteria

- `createWorktree()` creates a valid git worktree under `.autoloop/worktrees/<run-id>/`.
- `meta.json` is written with correct initial state.
- Branch collision is detected before worktree creation.
- `.gitignore` is verified/patched.
- All git commands use the main project dir as cwd.
