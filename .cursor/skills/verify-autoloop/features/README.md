# Autoloop verification map

This directory is the maintained source for verifying the operator-facing behavior of autoloop. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Build from the repository root with `npm ci` and `npm run build` when `packages/cli/dist/main.js` is missing. `node bin/autoloop --version` must match `package.json`.
- Export `AUTOLOOP_VERIFY_ROOT` to a new directory under `/tmp` and run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs init`.
- Drive only that session. The harness pins `AUTOLOOP_PROJECT_DIR` to `$AUTOLOOP_VERIFY_ROOT/project` and, for kanban, `AUTOLOOP_HOME` to `$AUTOLOOP_VERIFY_ROOT/home`.
- Run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs doctor` and require `"ok": true` before the first drive.
- Never drive an `autoloop dashboard` or `autoloop kanban` process this session did not start. Operator defaults are ports `4800` and `4801`.

## Driving conventions

- Start every recipe from a fresh `init` unless its preconditions say the session already holds data.
- CLI commands go through `control-autoloop.mjs cli --`.
- Browser commands go through one `control-autoloop.mjs browser` recipe. The step separator is ` :: `.
- HTTP reads go through `control-autoloop.mjs get`.
- Treat every command and selector as literal.
- Restore mutated memory and tasks inside the disposable project when the recipe says so. Do not remove `$AUTOLOOP_VERIFY_ROOT/evidence`.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- CLI proof includes the command, stdout, stderr, and exit code.
- UI proof includes visible text, an ARIA snapshot, and a full-page screenshot with the app heading visible.
- Mutation proof includes a second user-facing read of the stored value.
- Record the feature id in the evidence path.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with control-autoloop` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Run a loop and inspect it](./run-loop.md) covers starting a loop with the completion promise, then reading it back from `loops` and `inspect journal`.
- [Dashboard](./dashboard.md) covers opening the local operator UI and reading a completed run.
- [Memory](./memory.md) covers adding, listing, finding, and removing a learning.
- [Tasks](./tasks.md) covers adding, listing, and completing a task from the CLI.
- [Kanban](./kanban.md) covers adding a card on the board and reading it back after reload.
