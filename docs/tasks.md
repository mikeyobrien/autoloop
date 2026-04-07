# Tasks

Tasks are lightweight work items that agents create and track during a loop run. They are stored in an append-only JSONL file alongside the journal, using the same materialization-with-tombstones pattern. Open tasks gate loop completion — a run cannot emit its completion event while tasks remain open.

## Storage

Tasks live in a per-run JSONL file. The default path depends on isolation mode:

| Isolation mode | Path |
|---------------|------|
| `run-scoped` or `worktree` | `<effectiveStateDir>/tasks.jsonl` |
| `shared` | `.autoloop/runs/<runId>/tasks.jsonl` |

The path can be overridden via:
- Config key `core.tasks_file` (relative to project root; default `.autoloop/tasks.jsonl`)
- Environment variable `AUTOLOOP_TASKS_FILE` (absolute path, takes precedence over config)

## Entry format

Each line in the tasks file is a JSON object. There are two entry types:

### Task entry

```json
{"id": "task-1", "type": "task", "text": "implement retry logic", "status": "open", "source": "manual", "created": "2026-04-07T12:00:00Z"}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Sequential ID (`task-1`, `task-2`, ...) |
| `type` | `"task"` | Entry discriminator |
| `text` | string | Human-readable description |
| `status` | `"open"` \| `"done"` | Current state |
| `source` | string | Origin — `"manual"` for CLI-created tasks |
| `created` | string | ISO 8601 timestamp |
| `completed` | string (optional) | ISO 8601 timestamp, set when status becomes `"done"` |

### Tombstone entry

```json
{"id": "task-3", "type": "task-tombstone", "target_id": "task-1", "reason": "no longer needed", "created": "2026-04-07T13:00:00Z"}
```

Tombstones permanently remove a task from materialized views. The `target_id` field references the task being removed.

## Materialization

The file is append-only — updates and completions append new lines rather than editing existing ones. Materialization reads all lines in reverse order, keeping only the latest entry per ID and excluding tombstoned IDs:

1. Scan lines from newest to oldest.
2. If a `task-tombstone` is encountered, mark its `target_id` as tombstoned.
3. If a `task` entry's ID has been tombstoned or already seen, skip it.
4. Otherwise, bucket the entry as `open` or `done`.

The result is two lists: open tasks (oldest first by creation) and done tasks (most recently completed first).

## Lifecycle

```
add (open) → complete (done)
         ↘ update (open, new text)
         ↘ remove (tombstoned)
```

- **Add**: creates a new entry with status `open` and a sequential ID.
- **Complete**: appends a new `task` line for the same ID with `status: "done"` and a `completed` timestamp. Completing an already-done task is a no-op (returns false).
- **Update**: appends a new `task` line for the same ID with updated `text`, preserving the original status and timestamps.
- **Remove**: appends a `task-tombstone` entry targeting the task ID, with an optional reason.

## Completion gate

When a loop emits its completion event (default `task.complete`), the harness checks for open tasks. If any remain, the emit is rejected with a `task.gate` journal entry and an error listing the open task IDs. The agent must complete or remove all open tasks before the loop can finish.

## CLI

```
autoloop task <subcommand>
```

| Subcommand | Usage | Description |
|-----------|-------|-------------|
| `add` | `autoloop task add <text...>` | Create an open task; prints the new ID |
| `complete` | `autoloop task complete <id>` | Mark a task as done |
| `update` | `autoloop task update <id> <text...>` | Replace a task's description |
| `remove` | `autoloop task remove <id> [reason...]` | Tombstone a task (reason defaults to `"manual"`) |
| `list` | `autoloop task list [project-dir]` | Print all tasks grouped by status |

The CLI resolves the project directory from `AUTOLOOP_PROJECT_DIR` (defaults to `.`).

### In-loop usage

Inside a running loop, agents use the tool path directly:

```bash
<toolPath> task add "description of work item"
<toolPath> task complete task-1
```

## Prompt integration

Open and done tasks are rendered into the iteration prompt under a `Tasks:` header:

```
Tasks:
Open:
- [ ] [task-1] implement retry logic
Done:
- [x] [task-2] set up test fixtures (done)
```

The rendered text is subject to a character budget controlled by the `tasks.prompt_budget_chars` config key (default `4000`). When the budget is exceeded, entries are truncated from the bottom with a summary line showing how many entries were dropped.

Tasks also appear in the context pressure summary at the top of each iteration prompt (e.g., `Tasks: 2 open, 1 done (3 total)`).

## Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `core.tasks_file` | `.autoloop/tasks.jsonl` | Tasks file path (relative to project root) |
| `tasks.prompt_budget_chars` | `4000` | Max characters for tasks in the iteration prompt |
