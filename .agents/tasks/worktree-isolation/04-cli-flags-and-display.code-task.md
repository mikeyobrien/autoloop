# Task 4: CLI Flags and Display Changes

**RFC:** `docs/rfcs/worktree-isolation.md` §2, §5, §9
**Modified files:** `src/commands/run.ts`, `src/loops/render.ts`
**Depends on:** Task 1 (RunRecord.worktree_name)
**Estimated scope:** ~50 lines modified

## Objective

Add `--worktree` and related flags to `autoloop run`, and add the `WORKTREE` column to `autoloop loops`.

## Steps

### 1. Parse new flags in `src/commands/run.ts`

In `parseRunArgs()` (line 42), add handling for these tokens:

```typescript
if (token === "--worktree")       { options.worktree = true; i++; continue; }
if (token === "--no-worktree")    { options.worktree = false; i++; continue; }
if (token === "--automerge")      { options.automerge = true; i++; continue; }
if (token === "--keep-worktree")  { options.keepWorktree = true; i++; continue; }
if (token === "--merge-strategy") {
  const strategy = args[i + 1];
  if (!strategy || !["squash", "merge", "rebase"].includes(strategy)) {
    console.log("--merge-strategy must be squash, merge, or rebase");
    options.usageError = true; return options;
  }
  options.mergeStrategy = strategy;
  i += 2; continue;
}
```

Add the corresponding fields to the local `RunOptions` interface at the top of the file (line 8-18), and pass them through to `harness.run()`.

When `--automerge` is set: if `--chain` is not already set, transform it into `--chain <preset>,automerge`. If `--chain` is already set, append `,automerge`.

### 2. Add `WORKTREE` column to list view in `src/loops/render.ts`

In `renderListHeader()` (line 60), add `"WORKTREE".padEnd(16)` after the `ITER` column.

In `renderRunLine()` (line 7), add a `worktree` column after `iter`:

```typescript
truncateWorktree(r.worktree_name || "-", 14).padEnd(16),
```

Add a helper:
```typescript
function truncateWorktree(name: string, max: number): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 2) + "..";
}
```

### 3. Add `Worktree` field to detail view

In `renderRunDetail()` (line 23), add after the `Backend`/`Args` fields:

```typescript
field("Worktree", r.worktree_name || "-"),
```

### Acceptance criteria

- `autoloop run autocode --worktree "task"` parses cleanly and passes `worktree: true` to the harness.
- `autoloop run autocode --worktree --automerge "task"` transforms into a chain with automerge appended.
- `--merge-strategy` validates input.
- `autoloop loops` output includes a `WORKTREE` column showing branch names or `"-"`.
- `autoloop loops show <id>` includes `Worktree:` field.
- Existing runs (no worktree_name) display `"-"` cleanly.
