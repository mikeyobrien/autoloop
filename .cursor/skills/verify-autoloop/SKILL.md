---
name: verify-autoloop
description: "Drive autoloop the way an operator does — the CLI, the local dashboard, and the kanban board — and capture evidence from a disposable project. Use when asked to verify a change in the app, prove a loop or operator surface, or confirm behavior beyond the test suite."
---

# Verify autoloop

autoloop's primary surface is the `autoloop` CLI. Two local operator UIs sit on top of the same project: `autoloop dashboard` (run list and detail) and `autoloop kanban` (task board). Verification drives those surfaces against a disposable project. It does not use the repo checkout, `~/.autoloop`, or the operator ports `4800` and `4801`.

Run every command from the repository root. The harness is `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs`.

## Launch

Build once if `packages/cli/dist/main.js` is missing:

```sh
npm ci
npm run build
```

Ready means `node bin/autoloop --version` prints the `version` in `package.json` (currently `0.12.0`) and `packages/cli/dist/main.js` exists.

Start a verification session. `AUTOLOOP_VERIFY_ROOT` must be an empty directory under `/tmp`. Two sessions may run side by side only when each has its own root (its own project, `AUTOLOOP_HOME`, and ports).

```sh
export AUTOLOOP_VERIFY_ROOT=/tmp/autoloop-verify-$RUN_ID
node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs init
```

`init` is ready when stdout contains `created autoloops.toml` and a `ready` line. That creates:

- `$AUTOLOOP_VERIFY_ROOT/project` — `git init` plus `autoloop init .`. State lives in `project/.autoloop`.
- `$AUTOLOOP_VERIFY_ROOT/verify-backend.sh` — verification scaffolding. It prints `LOOP_COMPLETE` and ignores the prompt. `cleanup` deletes it.
- `$AUTOLOOP_VERIFY_ROOT/home` — kanban `AUTOLOOP_HOME`. Kanban scope is the git root of the server's cwd, so the harness starts kanban with cwd `project/`.
- `$AUTOLOOP_VERIFY_ROOT/evidence` — proof directory. Cleanup never removes it.
- `$AUTOLOOP_VERIFY_ROOT/session.json` — pid, port, and paths for this session.

There is no long-lived server for CLI commands. `dashboard start` and `kanban start` each bind `127.0.0.1` on an ephemeral port and are ready when stdout contains `Dashboard listening on http://127.0.0.1:<port>` or `Kanban listening on http://127.0.0.1:<port>`, the process is alive, and `GET /healthz` returns `{"status":"ok"}`.

`autoloop init` leaves `backend.command = "claude"` in `autoloops.toml`. A verification loop does not call Claude. Pass `-b "$AUTOLOOP_VERIFY_ROOT/verify-backend.sh"`.

## Doctor

Run this before the first drive, after every failed drive, and whenever a server looks wedged:

```sh
node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs doctor
```

Exit code `0` and `"ok": true` means the session is worth driving. The JSON must show:

- `version` equal to `expectedVersion`
- `projectDir` equal to `$AUTOLOOP_VERIFY_ROOT/project`
- `productDoctor.failures` equal to `0` and `productDoctor.projectDir` equal to that same project
- each server that has been started: `state` `up`, `portOwnedByPid` true, and `health.body` containing `"status":"ok"`

`productDoctor.warnings` is `3` before the first run and `2` after it. `backend` warns that `claude` is not on `PATH` (the `-b` script is per run, not the file). `completion-contract` warns that the starter config has no acceptance check. Before any run, `state` warns that `.autoloop` does not exist yet. Warnings keep `autoloop doctor` at exit code `0`. A check with `"status": "fail"` means the session is not worth driving.

A stopped server is reported as `"state": "stopped"`. That is healthy until a feature has started it. After `dashboard start` or `kanban start`, doctor must report that server `up` before any browser step.

## Drive

CLI drives:

```sh
node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs cli -- <autoloop-args>
```

The harness sets cwd and `AUTOLOOP_PROJECT_DIR` to the disposable project and strips every other `AUTOLOOP_*` variable. Do not run `node bin/autoloop` yourself for a proof: from the repo root that reads this checkout's `.autoloop`.

HTTP reads against the session server:

```sh
node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs get dashboard /healthz
node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs get kanban /api/tasks
```

Browser drives use one recipe so the page stays open across clicks. `goto` waits for `domcontentloaded`, not `networkidle`: the dashboard holds an `EventSource` on `/api/stream`, and kanban holds one on `/kanban/events`. Put ` :: ` between the verb and the value. Values are literal.

```sh
node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs browser <<'EOF'
server :: dashboard
goto :: /
wait heading :: autoloop / project
EOF
```

Verbs: `server`, `goto`, `reload`, `wait heading`, `wait text`, `click button`, `click <selector>`, `fill <selector>`, `screenshot`, `aria`, `text`. `click button` uses the accessible name. Any other `click` uses a CSS selector plus visible text. Relative screenshot, aria, and text paths are written under `$AUTOLOOP_VERIFY_ROOT/evidence/`.

The dashboard preset control is an unnamed combobox whose options are the bundled preset names (`autocode` first). The prompt is a textbox named `Describe what you want to do...`. The submit control is a button named `Start`. Section disclosures are `summary` elements (`Completed`, `Active`, and the rest), not buttons. A run row is `li.run-item`. The detail heading is `Run: <run-id>`.

Kanban's board is `GET /kanban` (the server redirects `/` to `/kanban`). The title field is `input[name="title"]`, the description field is `input[name="description"]`, and the submit control is a button named `Add`. The search field is a searchbox named `Filter tasks by text`.

Do not click dashboard `Start` or kanban `Start agent` on this session. Dashboard `Start` spawns `autoloop run --preset <bundled>` with that preset's backend (`claude` on the bundled presets). Kanban `Start agent` spawns a real loop. Neither path is the command-backend proof.

## Evidence

Write proof under `$AUTOLOOP_VERIFY_ROOT/evidence/<feature-id>/`. Capture the user action and the resulting state.

- CLI proof is the command, stdout, stderr, and exit code.
- A mutation (a completed loop, a memory entry, a task, a kanban card) needs a second user-facing read: `loops show`, `memory list`, `task list`, or a reloaded kanban board, plus the matching HTTP body when the feature has a UI.
- Dashboard and kanban proof includes the visible text, an ARIA snapshot, and a full-page screenshot. The heading that identifies the app must be in the screenshot (`autoloop / project` or `Autoloop Kanban`).
- `verify-backend.sh` only prints `LOOP_COMPLETE`. Confirm the journal's `backend.finish` output is that string and that no `claude` process was started. The script does not open a network connection.

Record the feature id and the entry point in the artifact names.

## Cleanup

```sh
node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs cleanup
```

Cleanup sends `SIGTERM` (then `SIGKILL` if needed) only to the dashboard and kanban pids stored in `session.json`. It then deletes `project/`, `home/`, `verify-backend.sh`, the server logs, and `session.json`. It leaves `$AUTOLOOP_VERIFY_ROOT/evidence/`. After cleanup, the evidence files must still exist and the project directory must be gone. Do not `kill` by process name.

Run cleanup after a failed attempt too, so a broken session does not keep the port.

## Helpers

`node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs <command>`

| Command | Effect |
| --- | --- |
| `init` | Create the disposable project, backend script, evidence dir, and session. |
| `doctor` | Print the readiness JSON and exit `0` only when `ok` is true. |
| `cli -- <args>` | Run `node bin/autoloop <args>` in the disposable project. |
| `dashboard start` / `dashboard stop` | Bind or stop this session's dashboard. |
| `kanban start` / `kanban stop` | Bind or stop this session's kanban. cwd is the disposable project. `AUTOLOOP_HOME` is `$AUTOLOOP_VERIFY_ROOT/home`. |
| `get <dashboard\|kanban> </path>` | Print a response body from that server. |
| `browser` | Run a recipe from stdin, or from a file path argument. |
| `cleanup` | Stop this session's servers and delete scratch state. Evidence stays. |

The browser launches Google Chrome through Playwright's `channel: "chrome"` when that channel launches, and otherwise Playwright's bundled Chromium. stderr prints `browser=chrome` or `browser=chromium`. A failure writes `$AUTOLOOP_VERIFY_ROOT/evidence/browser-failure.png` and leaves it for cleanup to keep.

## Maintenance

When commands, headings, or board controls change, update this skill with `/maintain-verification-skill`.
