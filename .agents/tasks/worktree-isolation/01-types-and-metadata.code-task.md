# Task 1: Worktree Types, Metadata, and RunRecord Extension

**RFC:** `docs/rfcs/worktree-isolation.md` §3c, §4, §10
**New files:** `src/worktree/meta.ts`
**Modified files:** `src/registry/types.ts`, `src/registry/derive.ts`, `src/harness/types.ts`
**Estimated scope:** ~120 lines new, ~15 lines modified

## Objective

Define the worktree metadata schema, add `worktree_name` to `RunRecord`, and extend `RunOptions`/`LoopContext` with worktree fields. This task has no dependencies and unblocks all others.

## Steps

### 1. Create `src/worktree/meta.ts`

Define types and read/write helpers for `.autoloop/worktrees/<run-id>/meta.json`:

```typescript
export type WorktreeStatus = "running" | "completed" | "failed" | "merged" | "removed";

export interface WorktreeMeta {
  run_id: string;
  branch: string;
  worktree_path: string;
  base_branch: string;
  status: WorktreeStatus;
  merge_strategy: string;       // "squash" | "merge" | "rebase"
  created_at: string;
  merged_at: string | null;
  removed_at: string | null;
}
```

Provide:
- `readMeta(metaDir: string): WorktreeMeta | null` — reads `meta.json` from the given dir, returns null if missing/corrupt.
- `writeMeta(metaDir: string, meta: WorktreeMeta): void` — atomic write (write to `.tmp` then rename).
- `updateStatus(metaDir: string, status: WorktreeStatus): void` — read-modify-write. Sets `merged_at` when transitioning to `"merged"`, `removed_at` when transitioning to `"removed"`.
- `metaDirForRun(mainStateDir: string, runId: string): string` — returns `join(mainStateDir, "worktrees", runId)`.

All paths should be resolved with `node:path` join. Use `mkdirSync({ recursive: true })` when writing.

### 2. Add `worktree_name` to `RunRecord` (`src/registry/types.ts`)

After `latest_event` (line 20), add:

```typescript
worktree_name: string;
```

### 3. Extract `worktree_name` in `src/registry/derive.ts`

In the `loop.start` block (line 25-44), add to the `RunRecord` literal:

```typescript
worktree_name: f.worktree_name ?? "",
```

### 4. Extend `RunOptions` in `src/harness/types.ts`

Add to the `RunOptions` interface (after `parentRunId`, line 35):

```typescript
worktree?: boolean;
mergeStrategy?: string;
keepWorktree?: boolean;
automerge?: boolean;
mainProjectDir?: string;  // set by worktree setup; points at the main tree root
```

Add to the `LoopContext.paths` type:

```typescript
mainProjectDir: string;  // same as projectDir for non-worktree runs
```

### Acceptance criteria

- `WorktreeMeta` type and CRUD helpers exist and are importable.
- `RunRecord.worktree_name` is defined; existing registries with missing field parse without error (already `undefined` → `""`).
- `RunOptions` carries worktree flags.
- `LoopContext.paths.mainProjectDir` is defined (populated in Task 3).
- No runtime behavior changes yet — this is types + helpers only.
