# Task 4: Harness Integration

**RFC:** `docs/rfcs/parallel-loop-isolation.md` &sect;2, &sect;5b, &sect;5d, &sect;10
**Modified files:** `src/harness/config-helpers.ts`, `src/harness/index.ts` (or equivalent run entry point)
**Estimated scope:** ~60 lines modified
**Dependencies:** Task 1 (types), Task 2 (run-scoped state), Task 3 (worktree create)

## Objective

Wire isolation resolution and worktree creation into the run lifecycle so that `autoloop run` automatically creates run-scoped state or a worktree based on the resolved isolation mode.

## Steps

### 1. Pre-run isolation setup in run entry point

Before calling `buildLoopContext`, resolve isolation mode:

```typescript
import { resolveIsolationMode } from "../isolation/resolve.js";
import { createWorktree } from "../worktree/create.js";

const activeRuns = getActiveRuns(registryFile);  // existing
const activeCodeRuns = activeRuns.filter(r => isCodeModifying(r.preset));

const { mode, warning } = resolveIsolationMode({
  worktreeFlag: runOptions.worktree,
  noWorktreeFlag: runOptions.noWorktree,
  configWorktreeEnabled: cfg.worktree?.enabled,
  presetCategory: getPresetCategory(preset),
  activeCodeRunInCheckout: activeCodeRuns.length > 0,
});

if (warning) console.error(warning);
```

### 2. Worktree creation (when mode === "worktree")

```typescript
if (mode === "worktree") {
  const wt = await createWorktree({
    mainProjectDir: resolvedProjectDir,
    mainStateDir: baseStateDir,
    runId,
    branchPrefix: cfg.worktree?.branch_prefix,
    mergeStrategy: cfg.worktree?.merge_strategy ?? runOptions.mergeStrategy,
  });
  runOptions.workDir = wt.worktreePath;
  runOptions.mainProjectDir = resolvedProjectDir;
  runOptions.isolationMode = "worktree";
}
```

### 3. Pass isolation mode into `buildLoopContext`

`buildLoopContext` uses `runOptions.isolationMode` to compute run-scoped stateDir (from Task 2). For worktree runs, `workDir` is already the worktree path, so `stateDir` naturally resolves inside the worktree.

### 4. Post-run worktree status update

After the run loop completes (success or failure), update worktree meta.json status:

```typescript
if (mode === "worktree") {
  const metaDir = metaDirForRun(baseStateDir, runId);
  updateStatus(metaDir, runResult.stopReason === "completed" ? "completed" : "failed");
}
```

### 5. Verify emit tool propagation

The emit tool's baked env vars should point to the run-scoped state directory. Verify by inspecting the generated `autoloops` script content after a worktree run.

### Acceptance Criteria

- `autoloop run --worktree` creates a worktree and runs the loop inside it.
- `autoloop run` with another active run creates run-scoped state.
- `autoloop run` as the only active run behaves identically to today.
- Warning is printed when code-modifying preset launches into a checkout with an active code-modifying run.
- Post-run meta.json status reflects completion/failure.
