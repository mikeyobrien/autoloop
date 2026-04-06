# Task 6: Worktree List and CLI Subcommands

**RFC:** `docs/rfcs/worktree-isolation.md` §9, §11
**New files:** `src/worktree/list.ts`, `src/commands/worktree.ts`
**Modified files:** `src/main.ts` (or wherever top-level command dispatch lives)
**Depends on:** Task 1 (meta.ts), Task 5 (merge.ts, clean.ts)
**Estimated scope:** ~130 lines

## Objective

Implement `autoloop worktree list|show|merge|clean` subcommands.

## Steps

### 1. Create `src/worktree/list.ts`

```typescript
export interface WorktreeEntry {
  meta: WorktreeMeta;
  gitWorktreeExists: boolean;  // cross-referenced with `git worktree list`
  orphan: boolean;             // meta exists but git worktree is gone
}

export function listWorktrees(stateDir: string, mainProjectDir: string): WorktreeEntry[]
```

Implementation:
1. Read all subdirs of `<stateDir>/worktrees/`.
2. For each, call `readMeta()`.
3. Run `git worktree list --porcelain` from `mainProjectDir`, parse output to get active worktree paths.
4. Cross-reference: if `meta.worktree_path` is not in the git worktree list, mark `orphan: true`.
5. Return sorted by `created_at` descending.

Render helper:
```typescript
export function renderWorktreeList(entries: WorktreeEntry[]): string
```
Format as a table: `RUN ID  BRANCH  STATUS  CREATED  ORPHAN`.

### 2. Create `src/commands/worktree.ts`

Dispatch function:
```typescript
export function dispatchWorktree(args: string[]): boolean
```

Subcommands:
- `list` → call `listWorktrees()` and print rendered table.
- `show <run-id>` → call `readMeta()` for the run-id, print all fields.
- `merge <run-id> [--strategy squash|merge|rebase]` → call `mergeWorktree()`, print result.
- `clean [--all] [--force] [run-id]` → call `cleanWorktree()` or `cleanAllWorktrees()`, print summary.
- No args / `--help` → print usage.

### 3. Register in command dispatch

In `src/main.ts` (or the top-level dispatcher), add:
```typescript
if (command === "worktree") return dispatchWorktree(rest);
```

### Acceptance criteria

- `autoloop worktree list` prints all worktrees with status and orphan detection.
- `autoloop worktree show <id>` prints metadata details.
- `autoloop worktree merge <id>` delegates to merge logic and prints outcome.
- `autoloop worktree clean` cleans eligible worktrees and prints summary.
- `autoloop worktree --help` prints usage.
- Orphaned worktrees (metadata exists but git worktree was manually removed) are flagged.
