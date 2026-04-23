# RFC: Two-Tier Memory — Project vs Run Scoping

**Status:** Draft
**Slug:** `two-tier-memory`
**Date:** 2026-04-07

## Summary

Split the autoloop memory system into two tiers — project memory (durable, shared across runs) and run memory (ephemeral, per-run) — so that learnings and meta notes from one run do not bleed into unrelated runs in the same workspace.

## Motivation

Memory is currently workspace-scoped via a single `memory.jsonl` file. When multiple runs execute in the same workspace with different objectives, metareview notes and task-specific learnings from run A appear in run B's prompt, confusing the agent. The fix is to scope ephemeral entries (learnings, meta) to the run that created them, while keeping durable entries (preferences) at the project level.

## Design

### Storage Layout

| Tier | Path | Lifetime | Content |
|------|------|----------|---------|
| Project | `<workDir>/.autoloop/memory.jsonl` | Permanent | Preferences, promoted learnings |
| Run | `<stateDir>/memory.jsonl` | Per-run | Learnings (default), meta (always) |

- **Project memory path** is unchanged — resolved via `AUTOLOOP_MEMORY_FILE` env or `core.memory_file` config.
- **Run memory path** is derived: `join(AUTOLOOP_STATE_DIR, "memory.jsonl")`. No new env var or config key needed.
- This mirrors the existing tasks routing pattern in `buildLoopContext`.

### Default Scoping Rules

| Command | Target Tier | Override |
|---------|-------------|----------|
| `memory add learning <text>` | Run | `--project` flag → Project |
| `memory add preference <cat> <text>` | Project | None (always project) |
| `memory add meta <key> <value>` | Run | None (always run) |
| `memory promote <id>` | Run → Project | N/A |
| `memory remove <id>` | Whichever tier contains it | N/A |

### Promote Semantics

`memory promote <id>`:
1. Read the entry from run memory by ID.
2. Append a copy to project memory with a new project-scoped ID (`mem-N` based on project file line count).
3. Append a tombstone in run memory for the original ID.
4. Print the new project ID.

Only learnings can be promoted (meta and preferences have fixed tiers).

### API Changes (`memory.ts`)

New function to resolve run memory path:

```typescript
export function resolveRunFile(stateDir: string): string {
  return join(stateDir, "memory.jsonl");
}
```

Existing `*Project` functions remain unchanged (they operate on project memory). New parallel functions for run-scoped operations:

```typescript
export function addRunLearning(stateDir: string, text: string, source: string): void
export function addRunMeta(stateDir: string, key: string, value: string): void
export function removeFromEither(projectDir: string, stateDir: string, id: string, reason: string): void
export function promote(projectDir: string, stateDir: string, id: string): void
```

New combined rendering function:

```typescript
export function renderTwoTier(
  projectPath: string,
  runPath: string,
  budgetChars: number,
): string
```

New combined stats function:

```typescript
export function statsTwoTier(
  projectPath: string,
  runPath: string,
  budgetChars: number,
): TwoTierMemoryStats
```

```typescript
export interface TwoTierMemoryStats {
  project: MemoryStats;
  run: MemoryStats;
  combinedRenderedChars: number;
  budgetChars: number;
  truncated: boolean;
}
```

### Prompt Rendering

`renderTwoTier` produces a single text block with two labeled sections:

```
Loop memory:
Project memory:
Preferences:
- [mem-1] [Workflow] Always run tests before emitting review.ready
Learnings:
- [mem-3] (promoted) Use .tsx for JSX files

Run memory:
Learnings:
- [mem-1] (manual) This task uses vitest for testing (created: ...)
Meta:
- [meta-1] smoke_iteration: 2 (created: ...)
```

When run memory is empty, the "Run memory:" section is omitted entirely. When project memory is empty, the "Project memory:" section is omitted. The "Loop memory:" header is always present if either tier has content.

### Truncation Strategy

The combined text is truncated against a single budget (`memory.prompt_budget_chars`). The key change is **drop ordering**:

1. Render project memory first, then run memory.
2. `truncateText` drops lines from the bottom → run memory entries drop first.
3. Within each tier, the existing order applies: meta → learnings → preferences (bottom to top).

This requires no change to `truncateText` itself — only the render order determines what gets dropped first.

The `TwoTierMemoryStats` passed to `contextPressureText` in `prompt.ts` must report combined stats. The pressure summary changes to show both tiers:

```
Memory: 4200/8000 chars across 15 entries (2 project preferences, 1 project learnings, 10 run learnings, 2 run meta)
```

### LoopContext Changes (`types.ts`)

Add `runMemoryFile` to `paths`:

```typescript
paths: {
  // ... existing fields ...
  memoryFile: string;      // project memory (unchanged)
  runMemoryFile: string;   // NEW: run memory
}
```

### Config Helpers Changes (`config-helpers.ts`)

In `buildLoopContext`, compute `runMemoryFile` using the same pattern as `tasksFile`:

```typescript
const runMemoryFile =
  isolation.mode === "run-scoped" || isolation.mode === "worktree"
    ? join(effectiveStateDir, "memory.jsonl")
    : join(stateDir, "runs", runId, "memory.jsonl");
```

### Prompt Changes (`prompt.ts`)

In `deriveRunContext`, replace the single `renderFile` call:

```typescript
// Before:
memoryText: memory.renderFile(loop.paths.memoryFile, loop.memory.budgetChars),
memoryStats: memory.statsFile(loop.paths.memoryFile, loop.memory.budgetChars),

// After:
memoryText: memory.renderTwoTier(loop.paths.memoryFile, loop.paths.runMemoryFile, loop.memory.budgetChars),
memoryStats: memory.statsTwoTier(loop.paths.memoryFile, loop.paths.runMemoryFile, loop.memory.budgetChars),
```

The `MemoryStats` type used in `DerivedRunContext` and `contextPressureText` changes to `TwoTierMemoryStats`. The `contextPressureText` function updates its summary format.

### CLI Changes (`commands/memory.ts`)

New resolution helper:

```typescript
function resolveRuntimeStateDir(): string | undefined {
  return process.env.AUTOLOOP_STATE_DIR || undefined;
}
```

Updated dispatch:

| Subcommand | Behavior |
|------------|----------|
| `add learning <text>` | Write to run memory (via `AUTOLOOP_STATE_DIR`). If `AUTOLOOP_STATE_DIR` unset, fall back to project memory. |
| `add learning --project <text>` | Write to project memory. |
| `add preference` | Write to project memory (unchanged). |
| `add meta` | Write to run memory. If `AUTOLOOP_STATE_DIR` unset, fall back to project memory. |
| `promote <id>` | Copy from run → project, tombstone in run. Requires `AUTOLOOP_STATE_DIR`. |
| `remove <id>` | Search both tiers, tombstone in whichever contains it. |
| `list` | Render both tiers (project first, then run). |
| `find <pattern>` | Search both tiers. |
| `status` | Show combined stats. |

The `--project` flag is parsed by stripping it from args before passing the text:

```typescript
case "learning": {
  const isProject = args.includes("--project");
  const textArgs = args.slice(1).filter(a => a !== "--project");
  // ...
}
```

### Tool Script (`tools.ts`)

No changes needed. `AUTOLOOP_STATE_DIR` and `AUTOLOOP_MEMORY_FILE` are already exported. The CLI derives run memory from `AUTOLOOP_STATE_DIR`.

### Constraint Verification

| Constraint | How addressed |
|------------|---------------|
| Zero breaking changes | `memory add learning` silently becomes run-scoped. Existing project memory file untouched. All `*Project` functions still work. |
| Worktree mode | `effectiveStateDir` is already per-worktree → run memory naturally isolated. |
| Chain steps | Each chain step gets a fresh `runId` and `stateDir` → fresh run memory. |
| Project memory readable from any run | `AUTOLOOP_MEMORY_FILE` still points to the shared project file. |
| Event tool run awareness | `AUTOLOOP_STATE_DIR` already exported per-run. |

### Migration

None. Existing `memory.jsonl` becomes project memory. Run memory files are created on first write. No data migration needed.

## Files Affected

| File | Change |
|------|--------|
| `src/memory.ts` | Add `resolveRunFile`, `addRunLearning`, `addRunMeta`, `removeFromEither`, `promote`, `renderTwoTier`, `statsTwoTier` |
| `src/memory-render.ts` | Add `TwoTierMemoryStats` interface. No change to `truncateText`. |
| `src/harness/types.ts` | Add `runMemoryFile` to `paths` |
| `src/harness/config-helpers.ts` | Compute `runMemoryFile` in `buildLoopContext` |
| `src/harness/prompt.ts` | Use `renderTwoTier`/`statsTwoTier`, update `contextPressureText` for two-tier stats |
| `src/commands/memory.ts` | Add `--project` flag, `promote` subcommand, two-tier `list`/`find`/`status`/`remove` |
| `test/memory.test.ts` | Add tests for run-scoped add, promote, two-tier render, fallback behavior |
| `test/memory-render.test.ts` | Add tests for two-tier truncation drop ordering |
| `docs/memory.md` | Document two-tier behavior, promote command, `--project` flag |
