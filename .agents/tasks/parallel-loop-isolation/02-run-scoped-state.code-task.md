# Task 2: Run-Scoped State Directory

**RFC:** `docs/rfcs/parallel-loop-isolation.md` &sect;2, &sect;3
**New files:** `src/isolation/run-scope.ts`
**Modified files:** `src/harness/config-helpers.ts`
**Estimated scope:** ~60 lines new, ~25 lines modified
**Dependencies:** Task 1 (types)

## Objective

Implement run-scoped state directories so that when isolation is active, each run's working files, journal, emit tool, and pi-adapter live under `.autoloop/runs/<run-id>/` while registry and memory remain shared at the top level.

## Steps

### 1. Create `src/isolation/run-scope.ts`

```typescript
export function createRunScopedDir(baseStateDir: string, runId: string): string
// Creates .autoloop/runs/<run-id>/ with mkdirSync({ recursive: true })
// Returns the absolute path

export function cleanRunScopedDirs(baseStateDir: string, opts: { maxAgeDays?: number; dryRun?: boolean }): string[]
// Lists .autoloop/runs/*, checks registry for terminal status + age
// Removes dirs meeting criteria; returns list of removed dirs
```

### 2. Modify `buildLoopContext` (`src/harness/config-helpers.ts:148-203`)

After computing `runId`, resolve isolation mode (call `resolveIsolationMode`). Then:

```typescript
const baseStateDir = join(resolvedWorkDir, config.get(cfg, "core.state_dir", ".miniloop"));
const runScoped = isolationMode !== "shared";
const stateDir = runScoped
  ? createRunScopedDir(baseStateDir, runId)
  : baseStateDir;
```

Update `paths`:

**Important:** `journalFile` and `memoryFile` are currently resolved via `config.resolveJournalFileIn()` / `config.resolveMemoryFileIn()` which respect `core.journal_file` and `core.memory_file` config keys. Do NOT hardcode `"journal.jsonl"` — extract the basename from the configured path so custom configs are preserved.

```typescript
const journalBasename = basename(config.journalPath(cfg));
const memoryBasename = basename(config.get(cfg, "core.memory_file", ".autoloop/memory.jsonl"));

paths: {
  projectDir: resolvedProjectDir,
  workDir: resolvedWorkDir,
  stateDir,
  baseStateDir,
  journalFile: runScoped                             // per-run when scoped
    ? join(stateDir, journalBasename)
    : config.resolveJournalFileIn(resolvedProjectDir, resolvedWorkDir),
  memoryFile: join(baseStateDir, memoryBasename),    // always shared, config-aware
  registryFile: join(baseStateDir, "registry.jsonl"), // always shared
  toolPath: join(stateDir, "autoloops"),
  piAdapterPath: join(stateDir, "pi-adapter"),
  mainProjectDir: runOptions.mainProjectDir ?? resolvedProjectDir,
}
```

### 3. Verify emit tool env var propagation

The emit tool script in `src/harness/tools.ts` bakes `AUTOLOOP_STATE_DIR` and `AUTOLOOP_JOURNAL_FILE` from `loop.paths`. Since these now point to the run-scoped directory, no changes are needed — but verify with a manual test that the tool resolves correctly.

### Acceptance Criteria

- When `isolationMode !== "shared"`, `stateDir` points to `runs/<run-id>/` and the directory is created.
- `registryFile` and `memoryFile` always point to `baseStateDir`.
- `journalFile`, `toolPath`, `piAdapterPath` point to the run-scoped dir.
- When `isolationMode === "shared"`, behavior is identical to current (stateDir === baseStateDir).
- `cleanRunScopedDirs` removes only terminal runs older than threshold.
