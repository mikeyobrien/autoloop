# RFC: Parallel Loop Isolation & Coordination

**Slug:** `parallel-loop-isolation`
**Status:** Draft
**Date:** 2026-04-04
**Subsumes:** `worktree-isolation` (RFC draft, same date)

## Summary

Enable multiple autoloop runs to execute in parallel without corrupting each other's state. Two complementary isolation strategies:

1. **Run-scoped state** — namespace per-run working files under `.autoloop/runs/<run-id>/` so concurrent runs in the same checkout don't clobber progress, plans, or journals. No git worktree required.
2. **Worktree-backed isolation** — create a `git worktree` per run for full code-level isolation. Lifecycle: create branch, run in worktree, merge results back.

A **decision model** determines which strategy applies by default, with operator override in both directions. A **conflict-detection heuristic** warns when two code-modifying runs target the same checkout.

Code tasks: `.agents/tasks/parallel-loop-isolation/01-*.code-task.md` through `07-*.code-task.md`

## Problem

Today all loops in a project share a single `.autoloop/` directory. This causes three categories of interference:

| Category | Symptom | Affected artifacts |
|----------|---------|-------------------|
| **Working-file clobbering** | A second run overwrites the first's state | `progress.md`, `plan.md`, `context.md`, `active-prompt.md` |
| **Journal/registry contention** | Concurrent appends can interleave partial lines for large payloads | `journal.jsonl` (lines > 4096 bytes), `registry.jsonl` |
| **Code-level conflicts** | Two runs editing the same source files produce merge conflicts or silent overwrites | Any tracked file |

The wave/branch system solves **intra-run** parallelism. This RFC addresses **inter-run** parallelism — multiple top-level `autoloop run` invocations.

## Goals

- **G1** Run-scoped working files so concurrent runs in the same checkout don't clobber each other.
- **G2** Per-run journals to eliminate large-line atomicity concerns.
- **G3** Shared registry with safe concurrent appends and new coordination fields.
- **G4** Git worktree lifecycle (create/run/merge/cleanup) as a harness-managed feature.
- **G5** Decision model: code-modifying presets default to worktree when another code-modifying run is active; planning/read-only presets use run-scoped state.
- **G6** Operator override via `--worktree` / `--no-worktree` flags.
- **G7** Operator visibility: isolation mode in `autoloop loops`, warnings, `autoloop worktree` subcommands.
- **G8** Failure recovery: orphaned worktrees, stale run directories, crash-safe writes.
- **G9** Backward-compatible: existing single-run `.autoloop/` layout works without changes.

## Non-Goals

- Distributed/multi-machine coordination (single host only).
- Automatic code merge between loops (operator or LLM merges; this spec defines the handoff).
- Changing wave/branch architecture (already works within a run).
- Real-time collaborative editing between loops.
- Worktrees for wave branches (intra-run isolation is already handled).
- Depending on external `wt` tool.

---

## Design

### 1. Decision Model

When `autoloop run` starts, the harness classifies the run and picks an isolation mode:

```
                    ┌──────────────────────┐
                    │  --worktree flag?     │
                    └──────┬───────────────┘
                      yes  │           no
                      ▼    │           ▼
                 WORKTREE  │  ┌────────────────────────┐
                           │  │  --no-worktree flag?    │
                           │  └──────┬─────────────────┘
                           │    yes  │           no
                           │    ▼    │           ▼
                           │  SHARED │  ┌──────────────────────────────┐
                           │         │  │  config worktree.enabled?    │
                           │         │  └──────┬───────────────────────┘
                           │         │    yes  │           no
                           │         │    ▼    │           ▼
                           │         │ WORKTREE│  ┌──────────────────────────────────┐
                           │         │         │  │  Code-modifying + active code    │
                           │         │         │  │  run in same checkout?           │
                           │         │         │  └──────┬───────────────────────────┘
                           │         │         │    yes  │           no
                           │         │         │    ▼    │           ▼
                           │         │         │  WARN + │     RUN-SCOPED
                           │         │         │  suggest│
                           │         │         │  --wt   │
                           └─────────┴─────────┴────────┘
```

**Preset categories** for conflict detection:

| Category | Presets | Default isolation |
|----------|---------|-------------------|
| **Code-modifying** | autocode, autofix, autotest, autosimplify, autoperf | Worktree when another code-modifying run is active; otherwise run-scoped |
| **Read-only/planning** | autospec, autoqa, autoreview, autoideas, autoresearch, autodoc, autosec | Run-scoped (no code changes) |

Classification source: preset metadata field `category: "code" | "planning"`. Falls back to name-based heuristic if missing.

### 2. Run-Scoped State Layout

When parallel isolation is active (any run started while another is active, or explicitly via config), working files are namespaced:

```
.autoloop/
├── registry.jsonl              # shared — global index
├── memory.jsonl                # shared — cross-run memory
├── runs/
│   ├── run-abc12345/
│   │   ├── autoloops           # emit tool (baked with run-scoped env vars)
│   │   ├── pi-adapter          # pi adapter script
│   │   ├── journal.jsonl       # per-run journal
│   │   ├── progress.md         # agent-created working files
│   │   ├── plan.md
│   │   ├── context.md
│   │   ├── spec-brief.md
│   │   ├── active-prompt.md
│   │   └── logs/
│   │       └── pi-stream.1.jsonl
│   └── run-def67890/
│       └── ...
└── worktrees/                  # only for worktree-backed runs
    └── run-ghi11111/
        └── meta.json           # lifecycle metadata
```

**What changes in `buildLoopContext`** (`src/harness/config-helpers.ts:148`):

```typescript
// Current:
const stateDir = join(resolvedWorkDir, config.get(cfg, "core.state_dir", ".miniloop"));

// New (when run-scoped):
const baseStateDir = join(resolvedWorkDir, config.get(cfg, "core.state_dir", ".miniloop"));
const stateDir = runScoped
  ? join(baseStateDir, "runs", runId)
  : baseStateDir;
```

**Key invariant:** `registryFile` and `memoryFile` always resolve against `baseStateDir`, not `stateDir`. Everything else (toolPath, piAdapterPath, journalFile, working files) uses the run-scoped `stateDir`.

```typescript
// Note: journalFile and memoryFile are currently resolved via
// config.resolveJournalFileIn / config.resolveMemoryFileIn which
// respect core.journal_file and core.memory_file config keys.
// When run-scoped, re-root the configured relative path under stateDir
// instead of hardcoding "journal.jsonl".
const journalRelPath = config.journalPath(cfg);         // e.g. ".autoloop/journal.jsonl"
const journalBasename = basename(journalRelPath);       // e.g. "journal.jsonl"
const memoryRelPath = config.get(cfg, "core.memory_file", ".autoloop/memory.jsonl");
const memoryBasename = basename(memoryRelPath);

paths: {
  projectDir: resolvedProjectDir,
  workDir: resolvedWorkDir,
  stateDir,                                         // run-scoped
  baseStateDir,                                     // NEW — always top-level .autoloop/
  journalFile: runScoped                            // per-run when scoped
    ? join(stateDir, journalBasename)
    : config.resolveJournalFileIn(resolvedProjectDir, resolvedWorkDir),
  memoryFile: join(baseStateDir, memoryBasename),   // shared, config-aware
  registryFile: join(baseStateDir, "registry.jsonl"), // shared
  toolPath: join(stateDir, "autoloops"),            // run-scoped
  piAdapterPath: join(stateDir, "pi-adapter"),      // run-scoped
  mainProjectDir: mainProjectDir ?? resolvedProjectDir, // for worktree runs
}
```

**Backward compatibility:** When only one run is active and no isolation is configured, `stateDir === baseStateDir` — identical to today's behavior. The `runs/` subdirectory is created on first parallel run.

### 3. Per-Run Journals

Each run writes to its own `journal.jsonl` inside `runs/<run-id>/`. This eliminates concurrent-append atomicity concerns — no two processes write to the same journal file.

**Timeline view:** `autoloop inspect journal` (full cross-run timeline) merges per-run journals by reading all `runs/*/journal.jsonl` files, sorting by timestamp. This is acceptable complexity for a diagnostic command.

**Single-run view:** `autoloop inspect journal --run <id>` reads only the run's journal file. Faster than filtering a shared journal.

### 4. Registry as Coordination Point

The shared `registry.jsonl` gains new fields for parallel coordination:

```typescript
export interface RunRecord {
  // ... existing fields ...
  isolation_mode: "shared" | "run-scoped" | "worktree";  // NEW
  worktree_name: string;   // NEW — branch name, or "" for non-worktree
  worktree_path: string;   // NEW — absolute path to worktree, or ""
}
```

**Concurrent-append safety:** Registry entries are ~300-500 bytes (well under PIPE_BUF 4096). `appendFileSync` with `O_APPEND` provides sufficient atomicity. No locking needed.

**Active run detection:** `activeRuns()` already filters for `status === "running"`. The decision model queries this + `isolation_mode` + `preset` to determine conflict risk.

### 5. Worktree-Backed Isolation

When `isolation_mode === "worktree"`, the harness creates a git worktree per run.

#### 5a. Configuration

New optional `[worktree]` section in `autoloops.toml`:

```toml
[worktree]
enabled = false            # default: no worktree
branch_prefix = "autoloop" # branch: <prefix>/<run-id>
cleanup = "on_success"     # on_success | always | never
merge_strategy = "squash"  # squash | merge | rebase
```

CLI flags override config:

| CLI Flag | Config Key | Default |
|----------|-----------|---------|
| `--worktree` | `worktree.enabled` | `false` |
| `--no-worktree` | (force disable) | — |
| `--merge-strategy <s>` | `worktree.merge_strategy` | `"squash"` |
| `--automerge` | (sugar: chain automerge step) | — |
| `--keep-worktree` | `worktree.cleanup` | `"on_success"` |

#### 5b. Lifecycle

```
1. CREATE   git worktree add .autoloop/worktrees/<run-id> -b autoloop/<run-id>
2. RUN      execute loop with workDir = worktree path
3. RECORD   write meta.json to .autoloop/worktrees/<run-id>/
4. MERGE    manual or automerge chain step
5. CLEANUP  conditional on cleanup policy
```

**Branch naming:** `autoloop/<run-id>` — namespaced, unique, discoverable via `git branch --list 'autoloop/*'`. If branch exists, fail fast.

**Worktree path:** `.autoloop/worktrees/<run-id>/` — automatically gitignored because `.autoloop/` is in `.gitignore`.

#### 5c. Worktree Metadata

Each worktree gets `meta.json` at `.autoloop/worktrees/<run-id>/meta.json` (in the **main tree**, not the worktree):

```typescript
export type WorktreeStatus = "running" | "completed" | "failed" | "merged" | "removed";

export interface WorktreeMeta {
  run_id: string;
  branch: string;               // "autoloop/run-abc12345"
  worktree_path: string;        // absolute path
  base_branch: string;          // branch worktree was created from
  status: WorktreeStatus;
  merge_strategy: string;
  created_at: string;
  merged_at: string | null;
  removed_at: string | null;
}
```

Status transitions: `running` → `completed` | `failed` → `merged` → `removed`.

#### 5d. State Split for Worktree Runs

| Artifact | Location | Rationale |
|----------|----------|-----------|
| `registry.jsonl` | Main tree `.autoloop/` | Global index; `autoloop loops` always reads from cwd |
| `journal.jsonl` | Worktree `.autoloop/` | Per-run isolation |
| `memory.jsonl` | Worktree `.autoloop/` | Per-run isolation |
| `autoloops` (emit tool) | Worktree `.autoloop/` | Scoped to active run |
| `meta.json` | Main tree `.autoloop/worktrees/<id>/` | Lifecycle tracking from main tree |

**Implementation:** For worktree runs, `workDir` becomes the worktree path, so journal/memory/working files naturally land in the worktree's `.autoloop/`. The `registryFile` is explicitly pinned to `mainProjectDir`'s `.autoloop/`:

```typescript
registryFile: join(mainTreeStateDir, "registry.jsonl"),
```

### 6. Merge Mechanism

#### Manual Merge

```bash
autoloop worktree merge <run-id> [--strategy squash|merge|rebase]
```

Steps:
1. Resolve worktree metadata from `.autoloop/worktrees/<run-id>/meta.json`
2. Verify status is `completed` (reject `running` or `merged`)
3. Switch to base branch
4. Execute strategy:
   - **squash** (default): `git merge --squash autoloop/<run-id>` + commit
   - **merge**: `git merge --no-ff autoloop/<run-id>`
   - **rebase**: `git rebase autoloop/<run-id>`
5. On success: update `meta.json` → `merged`, remove worktree, delete branch
6. On conflict: abort merge, print conflicting files + recovery commands, leave worktree intact

#### Automerge Chain Step

```bash
autoloop run autocode --worktree --automerge "Implement feature X"
# equivalent to:
autoloop run autocode --worktree --chain autocode,automerge "Implement feature X"
```

The `automerge` preset is a built-in preset that reads the parent run's worktree metadata and executes the merge. It runs in the **main tree** (not the worktree).

### 7. Operator UX

#### `autoloop loops` — list view

Add `ISOLATION` column:

```
RUN ID                STATUS      PRESET       ITER   ISOLATION        LATEST EVENT        UPDATED
run-abc12345          running     autocode     3      worktree         iteration.finish    2026-04-04T12:05Z
run-def67890          running     autospec     7      run-scoped       iteration.finish    2026-04-04T12:03Z
run-ghi11111          completed   autocode     12     shared           loop.complete       2026-04-04T11:30Z
```

#### `autoloop loops show <id>` — detail view

Add fields:

```
Isolation:    worktree
Worktree:     autoloop/run-abc12345
Base Branch:  main
Merge:        squash (pending)
```

#### Warnings

When launching a code-modifying run and another code-modifying run is active in the same checkout:

```
⚠ Active code-modifying run detected: run-abc12345 (autocode)
  Runs sharing the same checkout may produce code conflicts.
  Consider: autoloop run autocode --worktree "your prompt"
  Or suppress: autoloop run autocode --no-worktree "your prompt"
```

#### `autoloop worktree` subcommands

```
autoloop worktree list               # list worktrees with status
autoloop worktree merge <run-id>     # merge worktree into base branch
autoloop worktree clean [options]    # clean up worktrees
autoloop worktree show <run-id>      # show worktree metadata
```

### 8. Cleanup Policy

| Scenario | `on_success` (default) | `always` | `never` |
|----------|----------------------|----------|---------|
| Run completes + merge succeeds | Remove worktree + delete branch | Remove + delete | Keep |
| Run completes + merge fails | Keep worktree | Remove + delete | Keep |
| Run fails/stops/times out | Keep worktree | Remove + delete | Keep |

Manual cleanup:

```bash
autoloop worktree clean              # remove merged/failed worktrees (safe)
autoloop worktree clean --all        # remove all worktrees
autoloop worktree clean --force      # remove even dirty worktrees
autoloop worktree clean <run-id>     # remove specific worktree
```

**Stale run-scoped state:** `autoloop runs clean` removes `runs/<run-id>/` directories for completed/failed runs older than a configurable threshold (default 7 days).

### 9. Failure Modes & Recovery

| Failure | Behavior | Recovery |
|---------|----------|----------|
| Crash during run (run-scoped) | Run directory persists; registry shows `running` | `autoloop loops stop <id>` marks failed; `autoloop runs clean` removes state |
| Crash during run (worktree) | Worktree + branch persist; meta.json shows `running` | `autoloop loops stop <id>` + `autoloop worktree clean <id>` |
| `git worktree add` fails | Fail before loop starts; print error; exit non-zero | Fix git state; retry |
| Merge conflict | Abort merge; print conflicts + recovery commands | Resolve manually in worktree; `autoloop worktree merge --continue` |
| Worktree manually deleted | `autoloop worktree list` detects orphan (meta.json present, path missing) | `autoloop worktree clean` removes metadata |
| Registry corruption (partial line) | Reader skips malformed lines (existing behavior in `src/registry/read.ts`) | No action needed |
| Two runs write same code file (no worktree) | Git detects conflict on commit | Operator resolves; warning should have been shown at launch |

### 10. Env Var Propagation

The emit tool script (`src/harness/tools.ts`) bakes env vars at install time. Run-scoped paths flow automatically:

```sh
export MINILOOPS_STATE_DIR=/path/to/.autoloop/runs/run-abc12345
export MINILOOPS_JOURNAL_FILE=/path/to/.autoloop/runs/run-abc12345/journal.jsonl
export MINILOOPS_RUN_ID=run-abc12345
```

No changes needed to tool internals or pi-adapter — only to the paths that `buildLoopContext` computes.

### 11. Migration & Compatibility

- **Existing runs:** No migration. Missing `isolation_mode`/`worktree_name` fields parse as `undefined` → display as `"shared"` / `"-"`.
- **Existing presets:** Unchanged. Presets gain an optional `category` metadata field; missing = inferred from name.
- **Existing chains:** Unchanged. Chains can opt into worktree per-step.
- **Config:** New `[worktree]` section is additive. Missing = disabled.
- **Emit tool:** Env-var-based; automatically scoped.
- **Single-run case:** When only one run is active and no isolation flags are set, behavior is identical to today (`stateDir === baseStateDir`).

### 12. Implementation Modules

| Module | Location | Responsibility |
|--------|----------|---------------|
| `src/isolation/resolve.ts` | New | Decision model: determine isolation mode from flags + config + active runs |
| `src/isolation/run-scope.ts` | New | Create/clean run-scoped directories under `runs/<id>/` |
| `src/worktree/create.ts` | New | `git worktree add`, branch creation, meta.json write |
| `src/worktree/merge.ts` | New | Merge strategies (squash/merge/rebase), conflict detection |
| `src/worktree/clean.ts` | New | Worktree removal, branch deletion, metadata cleanup |
| `src/worktree/meta.ts` | New | Read/write meta.json, status transitions |
| `src/worktree/list.ts` | New | List worktrees, cross-reference with `git worktree list` |
| `src/commands/worktree.ts` | New | CLI dispatch for `autoloop worktree` subcommands |
| `src/commands/runs.ts` | New | CLI dispatch for `autoloop runs clean` |
| `src/registry/types.ts` | Modified | Add `isolation_mode`, `worktree_name`, `worktree_path` to RunRecord |
| `src/registry/derive.ts` | Modified | Extract new fields from `loop.start` |
| `src/loops/render.ts` | Modified | Add `ISOLATION` column to list/detail views |
| `src/commands/run.ts` | Modified | Parse `--worktree`, `--no-worktree`, `--automerge`, `--merge-strategy` |
| `src/harness/config-helpers.ts` | Modified | Compute run-scoped stateDir, thread baseStateDir, mainProjectDir |
| `src/harness/types.ts` | Modified | Add isolation/worktree fields to RunOptions, LoopContext.paths |
| `presets/automerge/` | New | Bundled automerge preset |

---

## Alternatives Considered

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| Per-run journal files | Eliminates concurrent-append risk entirely | Needs merge for full timeline view | **Adopted** |
| Shared journal with flock | Familiar locking pattern | Adds complexity; still need run-scoped working files | Fallback if per-run rejected |
| PID-based lockfile for entire run | Simple mutual exclusion | Too coarse — blocks legitimate parallel runs | **Rejected** |
| SQLite instead of JSONL | Real concurrency | Adds external dependency; violates constraints | **Rejected** |
| Separate `.autoloop-<run-id>` dirs at repo root | Run-scoped without nesting | Clutters repo root; .gitignore complexity | **Rejected** |
| Worktree-only solution | Simpler design | Doesn't help planning/spec loops that don't modify code | **Rejected** — need both |
| Shell out to `wt` | Proven tool | External dependency, version coupling | **Rejected** — self-contained |

## Open Questions

None — all questions from the brief and research phases have been answered and incorporated.
