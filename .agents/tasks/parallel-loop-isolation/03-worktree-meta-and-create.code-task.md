# Task 3: Worktree Metadata and Creation

**RFC:** `docs/rfcs/parallel-loop-isolation.md` &sect;5a-5c
**New files:** `src/worktree/meta.ts`, `src/worktree/create.ts`
**Estimated scope:** ~150 lines new
**Dependencies:** Task 1 (types)

## Objective

Implement worktree metadata schema and the `create` lifecycle step: branching, `git worktree add`, and `meta.json` write.

## Steps

### 1. Create `src/worktree/meta.ts`

Types and CRUD helpers for `.autoloop/worktrees/<run-id>/meta.json`:

```typescript
export type WorktreeStatus = "running" | "completed" | "failed" | "merged" | "removed";

export interface WorktreeMeta {
  run_id: string;
  branch: string;
  worktree_path: string;
  base_branch: string;
  status: WorktreeStatus;
  merge_strategy: string;
  created_at: string;
  merged_at: string | null;
  removed_at: string | null;
}

export function readMeta(metaDir: string): WorktreeMeta | null
export function writeMeta(metaDir: string, meta: WorktreeMeta): void  // atomic: write .tmp then rename
export function updateStatus(metaDir: string, status: WorktreeStatus): void
export function metaDirForRun(mainStateDir: string, runId: string): string
```

### 2. Create `src/worktree/create.ts`

```typescript
export interface CreateWorktreeOpts {
  mainProjectDir: string;
  mainStateDir: string;
  runId: string;
  branchPrefix?: string;     // default "autoloop"
  baseBranch?: string;       // default: current HEAD branch
  mergeStrategy?: string;    // default "squash"
}

export interface CreateWorktreeResult {
  worktreePath: string;      // absolute path
  branch: string;            // e.g. "autoloop/run-abc12345"
  metaDir: string;           // path to meta.json directory
}

export async function createWorktree(opts: CreateWorktreeOpts): Promise<CreateWorktreeResult>
```

Steps inside `createWorktree`:
1. Determine base branch (`git rev-parse --abbrev-ref HEAD`)
2. Compute branch name: `${branchPrefix}/${runId}`
3. Compute worktree path: `join(mainStateDir, "worktrees", runId)`
4. Fail fast if branch already exists (`git rev-parse --verify`)
5. `git worktree add <path> -b <branch>`
6. Write `meta.json` via `writeMeta`
7. Return result

Error handling:
- Branch exists → clear error message, exit before any side effects
- `git worktree add` fails → clean up partial state, throw with git error
- Disk full → let git error propagate

### Acceptance Criteria

- `createWorktree` creates a valid git worktree and writes meta.json.
- Branch is namespaced under configurable prefix.
- Fail-fast on branch collision.
- `readMeta` / `writeMeta` round-trip correctly.
- Atomic write (tmp + rename) prevents corrupt meta.json.
