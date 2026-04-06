# Task 1: Types, Registry Extension, and RunOptions

**RFC:** `docs/rfcs/parallel-loop-isolation.md` &sect;2, &sect;4
**New files:** `src/isolation/resolve.ts`
**Modified files:** `src/registry/types.ts`, `src/registry/derive.ts`, `src/harness/types.ts`
**Estimated scope:** ~80 lines new, ~30 lines modified
**Dependencies:** None (unblocks all other tasks)

## Objective

Extend the type system with isolation-awareness: add `isolation_mode`, `worktree_name`, `worktree_path` to `RunRecord`; add isolation and worktree fields to `RunOptions` and `LoopContext.paths`; create the isolation resolution function.

## Steps

### 1. Extend `RunRecord` (`src/registry/types.ts`)

After `latest_event` (line 20), add:

```typescript
isolation_mode: string;   // "shared" | "run-scoped" | "worktree"
worktree_name: string;    // branch name, or "" for non-worktree
worktree_path: string;    // absolute worktree path, or ""
```

### 2. Extract new fields in `src/registry/derive.ts`

In the `loop.start` block, add to the RunRecord literal:

```typescript
isolation_mode: f.isolation_mode ?? "shared",
worktree_name: f.worktree_name ?? "",
worktree_path: f.worktree_path ?? "",
```

### 3. Extend `RunOptions` (`src/harness/types.ts`)

Add after `parentRunId`:

```typescript
worktree?: boolean;
noWorktree?: boolean;
mergeStrategy?: string;
keepWorktree?: boolean;
automerge?: boolean;
mainProjectDir?: string;   // set by worktree setup code
isolationMode?: string;    // resolved by isolation/resolve.ts
```

Add to `LoopContext.paths`:

```typescript
baseStateDir: string;      // always top-level .autoloop/
mainProjectDir: string;    // same as projectDir for non-worktree runs
```

### 4. Create `src/isolation/resolve.ts`

Implements the decision model from RFC &sect;1:

```typescript
export type IsolationMode = "shared" | "run-scoped" | "worktree";

export function resolveIsolationMode(opts: {
  worktreeFlag?: boolean;
  noWorktreeFlag?: boolean;
  configWorktreeEnabled?: boolean;
  presetCategory?: "code" | "planning";
  activeCodeRunInCheckout: boolean;
}): { mode: IsolationMode; warning?: string }
```

Logic:
- `--worktree` → `"worktree"`
- `--no-worktree` → `"shared"`
- config `worktree.enabled` → `"worktree"`
- code-modifying + active code run → return `"run-scoped"` with warning suggesting `--worktree`
- otherwise → `"run-scoped"` if any other run is active, `"shared"` if solo

### Acceptance Criteria

- `RunRecord` has the three new fields; existing registries parse without error (undefined → defaults).
- `RunOptions` carries isolation/worktree flags.
- `LoopContext.paths` has `baseStateDir` and `mainProjectDir`.
- `resolveIsolationMode()` returns correct mode for all decision branches.
- No runtime behavior changes — types + resolution logic only.
