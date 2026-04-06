# RFC: Canonical Autoloop Task Tool

**Status:** Draft
**Slug:** `autoloop-task-tool`
**Date:** 2026-04-06

## Summary

Add a first-class task management tool to the autoloops harness that mirrors the memory tool pattern. Tasks are per-run structured items that agents create, update, and complete during a loop. The task list is the source of truth for outstanding work — a loop cannot emit its completion event until all tasks are marked done.

## Motivation

Loops currently have no formal mechanism for tracking discrete work items. Agents rely on prose in scratchpad or working files to communicate what remains. This makes it impossible for the harness to enforce work completion — agents can emit `task.complete` while work is still outstanding. A canonical task tool provides:

1. Structured, inspectable work tracking visible in every iteration prompt
2. A hard completion gate that prevents premature loop termination
3. Consistency with the memory tool pattern agents already know

## Design

### Task Entry Schema

```typescript
interface TaskEntry {
  id: string;            // "task-N", auto-assigned
  type: "task" | "task-tombstone";
  text: string;          // description
  status: "open" | "done";
  source: string;        // "manual" or "iter-N"
  created: string;       // ISO 8601
  completed?: string;    // ISO 8601, set when status → done
  // tombstone fields:
  target_id?: string;    // ID being removed
  reason?: string;       // why removed
}
```

### Storage

Append-only JSONL file, one entry per line, identical to the memory pattern:

- **Default path:** `.autoloop/tasks.jsonl` (per-run, resolved via `resolveTasksFileIn()`)
- **Config key:** `core.tasks_file`
- **Env override:** `AUTOLOOP_TASKS_FILE`
- **Path resolution:** Mirror `resolveMemoryFileIn()` in `src/config.ts` — env var > config key > default

ID generation reuses the `nextId(path, prefix)` pattern from `src/memory.ts`: count existing lines, return `task-(count+1)`.

### Materialization

`materialize(lines: string[])` collapses JSONL entries by ID:

1. Reverse-iterate lines (newest first)
2. Track seen IDs and tombstoned IDs
3. Skip entries whose ID is already seen or tombstoned
4. Return `{ open: TaskEntry[], done: TaskEntry[] }`

Open tasks sorted by creation time (oldest first). Done tasks sorted by completion time (most recent first).

### CLI Commands

New top-level subcommand `task` dispatched from `src/commands/task.ts`:

| Command | Behavior |
|---------|----------|
| `autoloops task add <text...>` | Append open task, print ID |
| `autoloops task complete <id>` | Append entry with `status: "done"`, `completed` timestamp |
| `autoloops task update <id> <text...>` | Append entry with same ID, new text, preserve status |
| `autoloops task remove <id>` | Append tombstone entry |
| `autoloops task list` | Print materialized task list (open then done) |

All positional args after the ID/subcommand are joined with spaces for multi-word text (same as memory `add`).

### Prompt Injection

New module `src/tasks-render.ts` mirroring `src/memory-render.ts`:

```
Tasks:
Open:
- [ ] [task-1] Implement the frobnicator parsing logic
- [ ] [task-3] Add unit tests for edge cases
Done:
- [x] [task-2] Set up project scaffolding (done)
```

- **Budget:** `tasks.prompt_budget_chars`, default 4000
- **Truncation:** Line-boundary split. Drop done tasks first (they're informational), then oldest open tasks. Append `"..."` footer with dropped count.
- **Injection point:** In `renderIterationPromptText()`, immediately after the memory section (line 243 of `prompt.ts`), before topology rendering. New field `tasksText` in derived context.

### Completion Gate

**Location:** `src/harness/emit.ts`, inside the `emit()` function.

When the emitted topic equals the completion event:

1. Resolve the tasks file for the current run
2. Materialize tasks
3. If `open.length > 0`: reject the emit with a clear error message listing the open task IDs and descriptions, exit code 1 (same as invalid event rejection)
4. If `open.length === 0` (or no tasks file exists): allow the emit to proceed normally

```typescript
// In emit(), after coordination topic check, before invalidEvent() check:
if (topic === validation.completionEvent) {
  const openTasks = materializeOpenTasks(projectDir);
  if (openTasks.length > 0) {
    rejectTaskGate(journalFile, topic, openTasks, validation);
    return;
  }
}
```

The rejection writes a distinct journal event (e.g., `task.gate`) so metareview can detect repeated gate failures. The stderr message is actionable:

```
Cannot complete: 2 open tasks remain:
  - [task-1] Implement the frobnicator parsing logic
  - [task-3] Add unit tests for edge cases
Complete or remove these tasks before emitting task.complete.
```

**Backward compatibility:** No tasks file or empty tasks file = no gate. Loops that don't use tasks are completely unaffected.

### Inspect Support

Add `inspect tasks` to `src/commands/inspect.ts`:

- **Terminal format:** Human-readable list with status checkboxes
- **JSON format:** Raw materialized tasks as JSON array
- **Markdown format:** Same as prompt injection rendering

### LoopContext Integration

Add to `LoopContext` in `src/harness/types.ts`:

```typescript
tasks: { budgetChars: number };
```

Add to `paths`:

```typescript
tasksFile: string;
```

Resolved in `src/harness/config-helpers.ts` alongside memory:

```typescript
tasks: {
  budgetChars: config.getNumber(cfg, "tasks.prompt_budget_chars", 4000),
},
```

### Derived Run Context

Add to the derived context computed in `prompt.ts`:

```typescript
tasksText: string;   // rendered task list or ""
tasksStats: { open: number; done: number; total: number; renderedChars: number; budgetChars: number };
```

`tasksStats` feeds into the context pressure section so agents see task counts alongside memory pressure.

## File Changes

| File | Type | Description |
|------|------|-------------|
| `src/tasks.ts` | New | Core CRUD, JSONL storage, materialization, `resolveFile()` |
| `src/tasks-render.ts` | New | Prompt rendering with budget truncation |
| `src/commands/task.ts` | New | CLI dispatch for task subcommands |
| `src/commands/inspect.ts` | Modify | Add `tasks` case |
| `src/config.ts` | Modify | Add `resolveTasksFile()`, `resolveTasksFileIn()` |
| `src/harness/config-helpers.ts` | Modify | Resolve tasks file path and budget into LoopContext |
| `src/harness/types.ts` | Modify | Add `tasks` and `tasksFile` to LoopContext |
| `src/harness/prompt.ts` | Modify | Inject task list, add tasksText/tasksStats to derived context |
| `src/harness/emit.ts` | Modify | Add completion gate check |
| `src/usage.ts` | Modify | Add task subcommand help text |
| `test/tasks.test.ts` | New | Unit tests: CRUD, materialization, ID generation |
| `test/tasks-render.test.ts` | New | Rendering, truncation, budget enforcement |
| `test/harness/task-gate.test.ts` | New | Completion gate: blocks when open, passes when clear |

## Invariants

1. **No tasks = no gate.** An empty or missing tasks file never blocks completion.
2. **Append-only.** Task state changes are new JSONL lines, never mutations.
3. **Materialization is deterministic.** Same JSONL input always produces same output.
4. **Gate is hard.** The completion event is rejected (exit code 1), not silently ignored.
5. **Per-run scope.** Tasks file lives alongside journal and memory in the run state directory.
6. **Budget-aware rendering.** Task prompt injection never exceeds configured budget.

## Open Decisions (resolved)

| Question | Decision | Rationale |
|----------|----------|-----------|
| Journal events for task items? | No | Tasks JSONL is the source of truth; journal already records agent events |
| Include `task update`? | Yes | Trivial with append-only pattern; agents refine descriptions as understanding evolves |
| Completion gate opt-in? | Always-on when tasks exist | Avoids confusing state where tasks exist but don't gate; mirrors requiredEvents behavior |
| Prompt budget default? | 4000 chars | Per-run tasks are shorter and fewer than cross-run memories; handles ~50 tasks |
