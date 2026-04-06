# RFC: Git Worktree Isolation for Autoloop Runs

**Slug:** `worktree-isolation`
**Status:** Draft
**Date:** 2026-04-04

## Summary

Add first-class git worktree support to autoloop so that runs can execute in an isolated working tree. This automates the manual workflow described in `docs/miniloops-wt-operating-playbook.md` — creating a branch, running the loop in a worktree, and merging results back — as a built-in harness feature with CLI, config, and chain integration.

## Motivation

Today operators isolate autoloop runs by manually invoking `wt switch --create`, `cd`-ing into the worktree, running the loop, and merging with `wt merge`. This works but:

- Requires the external `wt` tool (Worktrunk) and its shell integration
- Manual `cd` + merge is error-prone and not automatable
- Run metadata does not capture which worktree a run executed in
- No standard cleanup lifecycle for abandoned worktrees
- Chain steps cannot automatically inherit or create worktree isolation

Built-in worktree support removes the `wt` dependency, makes isolation a first-class flag, records worktree provenance in run metadata, and enables automerge as a composable chain step.

---

## Design

### 1. Opt-in Model

Worktree isolation is **opt-in** via two mechanisms:

| Mechanism | Scope | Precedence |
|-----------|-------|------------|
| `--worktree` CLI flag | Per-run | Highest (overrides config) |
| `worktree.enabled = true` in `autoloops.toml` | Per-preset | Default when flag absent |

When neither is set, runs execute in the current working directory (existing behavior, unchanged).

### 2. Configuration

New optional `[worktree]` section in `autoloops.toml`:

```toml
[worktree]
enabled = false            # default: no worktree
branch_prefix = "autoloop" # branch: <prefix>/<run-id>
cleanup = "on_success"     # on_success | always | never
merge_strategy = "squash"  # squash | merge | rebase
```

All fields are optional. Missing section = worktree disabled. CLI flags override individual settings:

| CLI Flag | Config Key | Default |
|----------|-----------|---------|
| `--worktree` | `worktree.enabled` | `false` |
| `--no-worktree` | (force disable) | — |
| `--merge-strategy <s>` | `worktree.merge_strategy` | `"squash"` |
| `--automerge` | (sugar for chaining automerge step) | — |
| `--keep-worktree` | `worktree.cleanup` | `"on_success"` |

### 3. Worktree Lifecycle

When `--worktree` is active, the harness performs these steps around the normal run loop:

```
1. CREATE   git worktree add .autoloop/worktrees/<run-id> -b autoloop/<run-id>
2. RUN      execute loop with workDir = .autoloop/worktrees/<run-id>
3. RECORD   write meta.json to .autoloop/worktrees/<run-id>/
4. CLEANUP  (conditional — see §8)
```

#### 3a. Branch Naming

Format: `autoloop/<run-id>` (e.g., `autoloop/run-abc12345`)

- Namespaced under `autoloop/` to avoid collision with user branches
- Uses the run ID which is already unique and compact
- Discoverable via `git branch --list 'autoloop/*'`
- If the branch already exists, fail fast with a clear error

#### 3b. Worktree Path

All worktrees are created under `.autoloop/worktrees/<run-id>/`. This path is automatically gitignored because `.autoloop/` is already in `.gitignore`.

#### 3c. Worktree Metadata

Each worktree gets a `meta.json` at `.autoloop/worktrees/<run-id>/meta.json`:

```json
{
  "run_id": "run-abc12345",
  "branch": "autoloop/run-abc12345",
  "worktree_path": "/abs/path/to/.autoloop/worktrees/run-abc12345",
  "base_branch": "main",
  "status": "running",
  "merge_strategy": "squash",
  "created_at": "2026-04-04T12:00:00Z",
  "merged_at": null,
  "removed_at": null
}
```

Status transitions: `running` → `completed` | `failed` → `merged` → `removed`.

### 4. RunRecord Extension

Add `worktree_name` to the `RunRecord` interface in `src/registry/types.ts`:

```ts
export interface RunRecord {
  // ... existing fields ...
  worktree_name: string;  // branch name or "" for non-worktree runs
}
```

**Derivation**: The `loop.start` journal event already emits `work_dir`. Add `worktree_name` to the emitted fields. In `src/registry/derive.ts`, extract it during `loop.start` processing:

```ts
worktree_name: f.worktree_name ?? "",
```

**Backward compatibility**: Existing `RunRecord` entries in `registry.jsonl` will parse with `worktree_name: undefined`, which is equivalent to `""` in display. No migration required.

### 5. CLI Display

#### List View (`autoloop loops`)

Add a `WORKTREE` column to `renderListHeader()` and `renderRunLine()` in `src/loops/render.ts`:

```
RUN ID                    STATUS      PRESET          ITER      WORKTREE        LATEST EVENT        UPDATED
run-abc12345              running     autocode        iter:3    autoloop/r..    iteration.finish    2026-04-04T12:05:00Z
run-def67890              completed   autospec        iter:7    -               loop.complete       2026-04-04T11:30:00Z
```

Column width: 16 chars. Non-worktree runs display `"-"`. Long branch names are truncated with `..`.

#### Detail View (`autoloop loops show`)

Add a `Worktree` field to `renderRunDetail()`:

```
Worktree:   autoloop/run-abc12345
```

### 6. State Isolation

The split-state model ensures global discoverability while maintaining per-run isolation:

| Artifact | Location | Rationale |
|----------|----------|-----------|
| `registry.jsonl` | Main tree `.autoloop/` | Global index; `autoloop loops` always reads from cwd |
| `journal.jsonl` | Worktree `.autoloop/` | Per-run isolation; no cross-run interference |
| `memory.jsonl` | Worktree `.autoloop/` | Per-run isolation |
| `autoloops` (emit tool) | Worktree `.autoloop/` | Scoped to active run |
| `meta.json` | Main tree `.autoloop/worktrees/<id>/` | Lifecycle tracking from main tree |

**Implementation**: `buildLoopContext()` in `src/harness/config-helpers.ts` already resolves `stateDir`, `journalFile`, and `memoryFile` relative to `workDir`. For worktree runs, `workDir` becomes the worktree path, so journal/memory naturally land in the worktree. The **registry path** needs an explicit override to always resolve against the main tree's `.autoloop/` directory, not the worktree's:

```ts
// In buildLoopContext, when worktree mode is active:
registryFile: join(mainTreeStateDir, "registry.jsonl"),
// instead of:
registryFile: join(stateDir, "registry.jsonl"),
```

This requires threading the main tree state dir through `buildLoopContext` when a worktree is active. A `mainProjectDir` field on `RunOptions` (set by the worktree setup code) is the cleanest approach.

### 7. Merge Mechanism

#### Manual Merge

```bash
autoloop worktree merge <run-id> [--strategy squash|merge|rebase]
```

Merge steps:
1. Resolve worktree metadata from `.autoloop/worktrees/<run-id>/meta.json`
2. Verify worktree is in `completed` status (reject `running` or already `merged`)
3. Switch to base branch
4. Execute strategy:
   - **squash** (default): `git merge --squash autoloop/<run-id>` + `git commit`
   - **merge**: `git merge --no-ff autoloop/<run-id>`
   - **rebase**: `git rebase autoloop/<run-id>`
5. On success: update `meta.json` status to `merged`, remove worktree, delete branch
6. On conflict: abort merge, print conflict details and recovery commands, leave worktree intact

#### Automerge Chain Step

A lightweight `automerge` preset that can be chained:

```bash
autoloop run autocode --worktree --chain autocode,automerge "Implement feature X"
```

Convenience sugar:

```bash
autoloop run autocode --worktree --automerge "Implement feature X"
```

`--automerge` is equivalent to `--chain <preset>,automerge`. The `automerge` preset is a built-in preset (bundled under `presets/automerge/`) that:
1. Reads the parent run's worktree metadata
2. Executes the merge using the configured strategy
3. Reports success/failure as its completion event

The `automerge` preset must run in the **main tree** (not the worktree), since it needs to perform the merge into the base branch. The chain runner passes the parent run's `run_id` via the handoff artifact so the automerge step knows which worktree to merge.

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

Cleanup performs:
1. `git worktree remove <path>` (with `--force` if `--force` flag given)
2. `git branch -d autoloop/<run-id>` (with `-D` if `--force`)
3. Remove `meta.json` from `.autoloop/worktrees/<run-id>/`

### 9. CLI Surface

New subcommand group: `autoloop worktree`

```
autoloop worktree list               # list worktrees with status
autoloop worktree merge <run-id>     # merge worktree into base branch
autoloop worktree clean [options]    # clean up worktrees
autoloop worktree show <run-id>      # show worktree metadata
```

Modified commands:

| Command | Change |
|---------|--------|
| `autoloop run` | Add `--worktree`, `--no-worktree`, `--automerge`, `--merge-strategy`, `--keep-worktree` flags |
| `autoloop loops` | Add `WORKTREE` column |
| `autoloop loops show` | Add `Worktree` field |

### 10. File Layout

```
.autoloop/
├── worktrees/
│   ├── run-abc12345/
│   │   └── meta.json
│   └── run-def67890/
│       └── meta.json
├── registry.jsonl           # global registry (includes worktree runs)
├── journal.jsonl            # main-tree journal
└── memory.jsonl             # main-tree memory

# Each worktree checkout:
.autoloop/worktrees/run-abc12345/    (git worktree root)
├── .autoloop/
│   ├── journal.jsonl                # worktree-scoped journal
│   ├── memory.jsonl                 # worktree-scoped memory
│   └── autoloops                    # runtime emit tool (copied)
├── src/                             # full repo checkout
└── ...
```

`.autoloop/` is already in `.gitignore`. No gitignore changes are required — but the implementation should verify this on first worktree creation and add the entry if missing.

### 11. Safety Constraints

1. **Never auto-delete dirty worktrees.** `git worktree remove` without `--force` enforces this naturally. The `clean` command requires `--force` to override.
2. **Never force-push.** Worktree branches are local-only. No remote interaction.
3. **Merge conflicts surface clearly.** On conflict, the merge aborts and prints: the list of conflicting files, a `cd` command to enter the worktree, and `git merge --abort` to reset.
4. **Registry atomicity.** The main-tree `registry.jsonl` uses `appendFileSync` (already `O_APPEND` semantics), which is safe for concurrent worktree runs appending to the same file.
5. **Branch collision fails fast.** If `autoloop/<run-id>` already exists as a branch, creation fails with a clear error before any worktree is created.
6. **Stale worktree detection.** `autoloop worktree list` cross-references `git worktree list` output against `.autoloop/worktrees/` metadata to flag orphans.

### 12. Error Handling

| Error | Behavior |
|-------|----------|
| `git worktree add` fails (branch exists, disk full, etc.) | Fail run before loop starts; print error; exit non-zero |
| Run fails inside worktree | Mark `meta.json` status as `failed`; keep worktree; registry shows `failed` |
| Merge conflict | Abort merge; print conflicting files + recovery commands; keep worktree |
| `git worktree remove` fails (dirty tree) | Warn user; suggest `--force`; leave worktree |
| Worktree path missing (manually deleted) | Mark `meta.json` as `removed`; skip cleanup; warn |
| Registry write fails during worktree run | Fail the iteration (existing error path); worktree remains |

### 13. Migration & Compatibility

- **Existing runs**: No migration. Missing `worktree_name` field parses as `undefined` → displays as `"-"`.
- **Existing chains**: Unchanged. Chains can opt into worktree per-step or for the entire chain.
- **Existing parallel branches**: Unchanged. Parallel branches use directory isolation within whatever tree (main or worktree) the parent run uses.
- **Config**: New `[worktree]` section is additive. Missing section = disabled.
- **`wt` interop**: The built-in feature is independent of `wt`. Users can continue using `wt` externally. However, mixing `wt`-managed and autoloop-managed worktrees for the same run is unsupported and should be documented as a non-goal.

### 14. Implementation Modules

| Module | Location | Responsibility |
|--------|----------|---------------|
| `src/worktree/create.ts` | New | `git worktree add`, branch creation, `meta.json` write |
| `src/worktree/merge.ts` | New | Merge strategies (squash/merge/rebase), conflict detection |
| `src/worktree/clean.ts` | New | Worktree removal, branch deletion, metadata cleanup |
| `src/worktree/meta.ts` | New | Read/write `meta.json`, status transitions |
| `src/worktree/list.ts` | New | List worktrees, cross-reference with `git worktree list` |
| `src/commands/worktree.ts` | New | CLI dispatch for `autoloop worktree` subcommands |
| `src/registry/types.ts` | Modified | Add `worktree_name` to `RunRecord` |
| `src/registry/derive.ts` | Modified | Extract `worktree_name` from `loop.start` |
| `src/loops/render.ts` | Modified | Add `WORKTREE` column to list/detail views |
| `src/commands/run.ts` | Modified | Parse `--worktree`, `--automerge`, `--merge-strategy` flags |
| `src/harness/config-helpers.ts` | Modified | Thread worktree paths into `buildLoopContext` |
| `src/harness/types.ts` | Modified | Add worktree fields to `RunOptions` |
| `presets/automerge/` | New | Bundled automerge preset |

### 15. Discoverability

- `autoloop run --help` lists `--worktree` and related flags
- `autoloop worktree --help` lists subcommands
- `autoloop loops` always shows the `WORKTREE` column (with `"-"` for non-worktree runs) so users discover the feature naturally
- `autoloop worktree list` shows all worktrees with their status, branch, and associated run ID

---

## Alternatives Considered

### A. Shell out to `wt` instead of raw `git worktree`

Pro: Proven tool, handles edge cases. Con: External dependency, version coupling, not available on all machines. **Rejected** — the feature should be self-contained.

### B. Worktree as a harness wrapper (external to the loop)

Pro: Simpler — just wrap `autoloop run` in create/merge. Con: No metadata propagation, no registry awareness, no chain integration. **Rejected** — first-class integration is the whole point.

### C. Automerge as a built-in harness phase (not a chain step)

Pro: Simpler invocation. Con: Mixes git merge operations with agent iteration, less composable, harder to debug. **Rejected** — chain step is more idiomatic and composable.

---

## Open Questions

None remaining — all 7 original questions from the brief have been answered by the research phase and incorporated into this design.
