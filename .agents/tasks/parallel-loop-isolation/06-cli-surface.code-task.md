# Task 6: CLI Flags, Subcommands, and Display

**RFC:** `docs/rfcs/parallel-loop-isolation.md` &sect;5a, &sect;7
**New files:** `src/commands/worktree.ts`
**Modified files:** `src/commands/run.ts`, `src/loops/render.ts`
**Estimated scope:** ~120 lines new, ~30 lines modified
**Dependencies:** Task 1 (types), Task 5 (merge/clean)

## Objective

Add CLI flags to `autoloop run`, implement `autoloop worktree` subcommands, and update loop list/detail rendering to show isolation mode.

## Steps

### 1. Add flags to `autoloop run` (`src/commands/run.ts`)

New flags:

| Flag | Type | Maps to RunOptions field |
|------|------|-------------------------|
| `--worktree` | boolean | `worktree: true` |
| `--no-worktree` | boolean | `noWorktree: true` |
| `--merge-strategy <s>` | string | `mergeStrategy: s` |
| `--automerge` | boolean | `automerge: true` |
| `--keep-worktree` | boolean | `keepWorktree: true` |

When `--automerge` is set and a `--chain` is not already specified, append `,automerge` to the chain.

### 2. Create `src/commands/worktree.ts`

Implement subcommand dispatch:

```
autoloop worktree list
autoloop worktree show <run-id>
autoloop worktree merge <run-id> [--strategy <s>]
autoloop worktree clean [--all] [--force] [<run-id>]
```

**list**: Read all `.autoloop/worktrees/*/meta.json`, cross-reference with `git worktree list`, render table:

```
RUN ID           BRANCH                    STATUS      BASE     STRATEGY   CREATED
run-abc12345     autoloop/run-abc12345     completed   main     squash     2026-04-04T12:00Z
run-def67890     autoloop/run-def67890     running     main     merge      2026-04-04T12:30Z
```

**show**: Pretty-print a single meta.json.

**merge**: Call `mergeWorktree()` from Task 5. Print result or conflicts.

**clean**: Call `cleanWorktrees()` from Task 5. Print removed IDs or dry-run output.

### 3. Register subcommand in CLI router

Add `worktree` to the command dispatch in the CLI entry point (pattern matches existing subcommand registration).

### 4. Update `autoloop loops` display (`src/loops/render.ts`)

Add `ISOLATION` column to `renderListHeader()` and `renderRunLine()`:

- Value: `RunRecord.isolation_mode` — displays `shared`, `run-scoped`, or `worktree`
- Column width: 12 chars

Add to `renderRunDetail()`:

```
Isolation:    worktree
Worktree:     autoloop/run-abc12345
```

Only show `Worktree:` line when `worktree_name` is non-empty.

### Acceptance Criteria

- `autoloop run --worktree` is parseable and flows to RunOptions.
- `autoloop worktree list/show/merge/clean` all work with correct output.
- `autoloop loops` shows ISOLATION column.
- `autoloop loops show` includes worktree detail when applicable.
