# Task 7: Automerge Preset and Journal Timeline Merge

**RFC:** `docs/rfcs/parallel-loop-isolation.md` &sect;3, &sect;6
**New files:** `presets/automerge/harness.md`, `presets/automerge/roles/merge.md`
**Modified files:** `src/harness/journal.ts` (or inspect command)
**Estimated scope:** ~60 lines new, ~20 lines modified
**Dependencies:** Task 5 (merge), Task 6 (CLI)

## Objective

Create the built-in `automerge` preset for chaining after worktree runs, and implement cross-run journal merging for `autoloop inspect journal`.

## Steps

### 1. Create `presets/automerge/` preset

**`presets/automerge/harness.md`**: Minimal harness instructions that tell the agent to:
1. Read the parent run's worktree metadata (passed via chain handoff artifact)
2. Call `autoloop worktree merge <parent-run-id>`
3. Report success/failure

This preset runs in the **main tree** (not the worktree). Set `category: "planning"` in metadata so it never triggers worktree isolation itself.

**`presets/automerge/roles/merge.md`**: Single role that executes the merge.

### 2. Cross-run journal merge for `autoloop inspect journal`

When per-run journals exist under `runs/*/journal.jsonl`, the inspect command needs to merge them for a full timeline view:

```typescript
export function readAllJournals(baseStateDir: string): JournalLine[] {
  const runDirs = readdirSync(join(baseStateDir, "runs"), { withFileTypes: true })
    .filter(d => d.isDirectory());

  const lines: JournalLine[] = [];
  // Also read legacy top-level journal if it exists
  const topLevel = join(baseStateDir, "journal.jsonl");
  if (existsSync(topLevel)) lines.push(...readJournal(topLevel));

  for (const dir of runDirs) {
    const jf = join(baseStateDir, "runs", dir.name, "journal.jsonl");
    if (existsSync(jf)) lines.push(...readJournal(jf));
  }

  return lines.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
```

Update `autoloop inspect journal` to use `readAllJournals` when `--run` is not specified. When `--run <id>` is specified, read only `runs/<id>/journal.jsonl`.

### 3. Preset metadata: category field

Add support for an optional `category` field in preset harness.md frontmatter (or equivalent metadata location):

```yaml
category: code    # or "planning"
```

This is read by `resolveIsolationMode()` (Task 1) to classify presets. When missing, fall back to name-based heuristic (presets starting with `autocode`, `autofix`, `autotest` → `"code"`; everything else → `"planning"`).

### Acceptance Criteria

- `autoloop run autocode --worktree --automerge "prompt"` chains into the automerge preset after completion.
- Automerge preset successfully merges the parent run's worktree.
- `autoloop inspect journal` merges per-run journals into a chronological timeline.
- `autoloop inspect journal --run <id>` reads only that run's journal.
- Preset `category` metadata is respected by the isolation decision model.
