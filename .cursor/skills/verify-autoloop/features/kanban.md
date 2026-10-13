# Kanban

Kanban is the local task board. An operator adds a card from the header form and sees it in the Backlog column. Adding a card does not start an agent.

## Sub-features

- `kanban-open` shows the board heading and the new-task form.
- `kanban-add` submits a title and description.
- `kanban-persist` shows that card in Backlog after a reload.
- `kanban-api` returns the same card from `GET /api/tasks`.

## How to get to it (user POV)

- Run `autoloop kanban` and open `/kanban`.
- Type a title and description and choose `Add`.
- Read the Backlog column.
- Choose `Start agent` on a card only when a real loop should start. This recipe does not.

## Driving it with control-autoloop

Preconditions:

- `init` has completed and `doctor` printed `"ok": true`.
- `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs kanban start` printed `Kanban listening on http://127.0.0.1:<port>`.
- `doctor` then reports `kanban.state` `up`, `kanban.portOwnedByPid` true, and `kanban.health.body` containing `"status":"ok"`.
- `get kanban /api/tasks` is `[]`.

- **Open the board.** The browser recipe waits for the heading `Autoloop Kanban`.
- **Add a card.** Fill `input[name="title"]` with `Release checklist` and `input[name="description"]` with `Tag and publish`, then click the button named `Add`.
- **Reload and read Backlog.** Reload `/kanban`. The visible text contains `Release checklist` and `Tag and publish` under Backlog. The recipe writes `$AUTOLOOP_VERIFY_ROOT/evidence/kanban/board.png`, `board.aria.txt`, and `board.txt`. The screenshot shows `Autoloop Kanban` and `Release checklist`.
- **Read the API.** Run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs get kanban /api/tasks`. Exit code `0`. The JSON array has one object whose `title` is `Release checklist`, `description` is `Tag and publish`, and `scope` is the absolute `$AUTOLOOP_VERIFY_ROOT/project` path. Save the body to `$AUTOLOOP_VERIFY_ROOT/evidence/kanban/tasks.json`.

```sh
node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs browser <<'EOF'
server :: kanban
goto :: /kanban
wait heading :: Autoloop Kanban
fill input[name="title"] :: Release checklist
fill input[name="description"] :: Tag and publish
click button :: Add
reload
wait heading :: Autoloop Kanban
wait text :: Release checklist
wait text :: Tag and publish
screenshot :: kanban/board.png
aria :: kanban/board.aria.txt
text :: kanban/board.txt
EOF
```

## Gotchas

- Kanban stores cards under `AUTOLOOP_HOME` (default `~/.autoloop`), scoped to the git root of the server cwd. The harness sets `AUTOLOOP_HOME` to `$AUTOLOOP_VERIFY_ROOT/home` and cwd to the disposable project. Starting kanban from the autoloop checkout attaches cards to that repo.
- `--project-dir` does not select the task scope. Scope follows cwd.
- After `Add`, the card is already in `GET /api/tasks`, but the open page may not paint it: the file watcher does not always see a new `tasks.jsonl` created under a new scope directory. Reload `/kanban` and require the title on the reloaded board. A cleared form alone is not proof.
- Do not click the button named `Start agent`. That spawns a loop.
- The worktree toggle is disabled when the scope is not a git repo. `init` creates a git repo, so the toggle is enabled. Leave it off. The card must not be a worktree run.
- `hide closed` in the header is a link, not the proof of a new card. The new card is in Backlog.
