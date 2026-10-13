# Tasks

Tasks lets an operator add an open task, list it, and mark it done from the CLI.

## Sub-features

- `task-add` creates an open task and prints its id.
- `task-list` shows the open task.
- `task-complete` moves that task to Done.
- `task-missing` reports an unknown id without a failed exit code.

## How to get to it (user POV)

- Run `autoloop task add <text>`.
- Run `autoloop task list`.
- Run `autoloop task complete <id>`.

## Driving it with control-autoloop

Preconditions:

- `init` has completed and `doctor` printed `"ok": true`.
- `task list` prints `No tasks.`

- **Add a task.** Run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs cli -- task add "Release checklist"`. Exit code `0`. Stdout is `task-1`. Save stdout to `$AUTOLOOP_VERIFY_ROOT/evidence/tasks/add.txt`.
- **List open tasks.** Run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs cli -- task list`. Exit code `0`. Stdout contains `Open:` and `- [ ] [task-1] Release checklist`. Save stdout to `$AUTOLOOP_VERIFY_ROOT/evidence/tasks/open.txt`.
- **Complete it.** Run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs cli -- task complete task-1`. Exit code `0`. Stdout contains `completed task-1`.
- **List done tasks.** Run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs cli -- task list`. Exit code `0`. Stdout contains `Done:` and `- [x] [task-1] Release checklist`, and does not contain `Open:`. Save stdout to `$AUTOLOOP_VERIFY_ROOT/evidence/tasks/done.txt`.
- **Unknown id.** Run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs cli -- task complete task-999`. Exit code `0`. Stdout contains `warning: no open task with ID task-999 found`. Save stdout to `$AUTOLOOP_VERIFY_ROOT/evidence/tasks/missing.txt`.

## Gotchas

- `task complete` exits `0` when the id is missing. The warning text is the proof, not the exit code.
- The first task in an empty project is `task-1`. Read the id from `task add` when the project is not empty.
- This is the CLI task list in `.autoloop/tasks.jsonl`. The kanban board is a separate store under `AUTOLOOP_HOME` and does not show these tasks.
