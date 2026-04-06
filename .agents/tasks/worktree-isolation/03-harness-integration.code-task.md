# Task 3: Harness Integration — Worktree Lifecycle in Run Path

**RFC:** `docs/rfcs/worktree-isolation.md` §3, §6
**Modified files:** `src/harness/config-helpers.ts`, `src/harness/index.ts`
**Depends on:** Task 1 (types), Task 2 (create.ts)
**Estimated scope:** ~60 lines modified

## Objective

Wire worktree creation into the run lifecycle so `--worktree` runs execute inside the worktree and write the registry to the main tree.

## Steps

### 1. Modify `buildLoopContext()` in `src/harness/config-helpers.ts`

Currently (lines 148-203), `buildLoopContext` resolves paths relative to `workDir`. When `runOptions.worktree` is truthy:

1. **Before** resolving paths, call `createWorktree()` with `mainProjectDir = resolvedWorkDir`, `stateDir`, `runId`, and config-derived `branchPrefix`/`mergeStrategy`.
2. Set `resolvedWorkDir = result.worktreePath` (the worktree becomes the effective work dir).
3. Resolve `stateDir`, `journalFile`, `memoryFile` relative to the **worktree's** `.autoloop/`.
4. Resolve `registryFile` relative to the **main tree's** `.autoloop/` (not the worktree's):
   ```typescript
   registryFile: join(mainStateDir, "registry.jsonl"),
   ```
5. Set `paths.mainProjectDir = mainProjectDir` (the original cwd).

For non-worktree runs, set `paths.mainProjectDir = resolvedWorkDir` (identity).

### 2. Read worktree config from `autoloops.toml`

In `reloadLoop()`, read the `[worktree]` config section to populate defaults:

```typescript
const wtBranchPrefix = config.get(cfg, "worktree.branch_prefix", "autoloop");
const wtCleanup = config.get(cfg, "worktree.cleanup", "on_success");
const wtMergeStrategy = config.get(cfg, "worktree.merge_strategy", "squash");
```

These are used when `runOptions.worktree` is true and the corresponding CLI flag wasn't passed explicitly.

### 3. Emit `worktree_name` in `loop.start` journal event

In `src/harness/index.ts` (or wherever `loop.start` is emitted), add `worktree_name` to the emitted fields:

```typescript
worktree_name: loop.paths.mainProjectDir !== loop.paths.workDir
  ? branchName   // the worktree branch, e.g. "autoloop/run-abc12345"
  : ""
```

This propagates through the journal → `derive.ts` → `RunRecord.worktree_name`.

### 4. Post-run status update

After the run loop completes (success or failure), update `meta.json` status:
- On success (`loop.complete`): `updateStatus(metaDir, "completed")`
- On failure/stop: `updateStatus(metaDir, "failed")`

### Acceptance criteria

- `autoloop run autocode --worktree "task"` creates a worktree, runs the loop inside it, and writes the registry to the main tree.
- `journal.jsonl` and `memory.jsonl` live inside the worktree's `.autoloop/`.
- `registry.jsonl` in the main tree includes the run with `worktree_name` populated.
- `meta.json` transitions to `completed` or `failed` after the run.
- Non-worktree runs are completely unchanged.
