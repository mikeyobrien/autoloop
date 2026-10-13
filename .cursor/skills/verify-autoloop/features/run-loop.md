# Run a loop and inspect it

Run a loop lets an operator start a preset against a project, then read the finished run from the loops list, the run detail, and the journal.

## Sub-features

- `run-start` starts a loop in the disposable project with a command backend.
- `run-complete` finishes because the backend printed `LOOP_COMPLETE`.
- `loops-list` shows that run as `completed`.
- `loops-show` shows the objective and stop reason.
- `inspect-journal` records the objective and `loop.complete` in JSON.

## How to get to it (user POV)

- Run `autoloop run <project-dir> -b <command> --max-iterations 2 "Verify the login bug"`.
- Run `autoloop loops --all`.
- Run `autoloop loops show <run-id>`.
- Run `autoloop inspect journal --format json`.

## Driving it with control-autoloop

Preconditions:

- `control-autoloop.mjs init` has completed and `doctor` printed `"ok": true`.
- The project has no runs yet.
- `$AUTOLOOP_VERIFY_ROOT/verify-backend.sh` exists and is executable.

- **Start the loop.** Run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs cli -- run . -b "$AUTOLOOP_VERIFY_ROOT/verify-backend.sh" --max-iterations 2 "Verify the login bug"`. Exit code `0`. Stdout contains `outcome=complete:completion_promise`, `stop_reason: completion_promise`, and `LOOP_COMPLETE`. Save stdout and stderr to `$AUTOLOOP_VERIFY_ROOT/evidence/run-loop/run.txt`.
- **List runs.** Run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs cli -- loops --all --json`. Exit code `0`. The JSON array has one object whose `status` is `completed`, `preset` is `project`, and `latest_event` is `loop.complete`. Its `run_id` is the id for the rest of this recipe. Save stdout to `$AUTOLOOP_VERIFY_ROOT/evidence/run-loop/loops.json`.
- **Show the run.** Run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs cli -- loops show <run-id>`. Exit code `0`. Stdout contains `Status:     completed`, `Objective:  Verify the login bug`, and `Stop:       completion_promise`. Save stdout to `$AUTOLOOP_VERIFY_ROOT/evidence/run-loop/show.txt`.
- **Read the journal.** Run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs cli -- inspect journal --format json`. Exit code `0`. Stdout contains `"topic": "loop.complete"` and `"objective": "Verify the login bug"`. Save stdout to `$AUTOLOOP_VERIFY_ROOT/evidence/run-loop/journal.json`.

## Gotchas

- `autoloop run autocode` uses the bundled preset and the `claude` backend. This recipe runs the directory created by `autoloop init`, which is the positional project, and overrides the backend with `-b`.
- `loops` and `inspect` read `AUTOLOOP_PROJECT_DIR`. The harness sets it. A bare `node bin/autoloop loops` from the repo root reads the checkout instead.
- `inspect journal` without `--format json` pretty-prints and truncates fields. The proof uses JSON.
- Run ids are generated words such as `strong-parser`, not a `run-` prefix. Read `run_id` from `loops --all --json`.
- `autoloop doctor` still warns that `claude` is not on `PATH` because `autoloops.toml` was not rewritten. The run's backend is the `-b` script, which the show view names `verify-backend.sh`.
- Stdout also contains `outcome=provisional:awaiting_acceptance` before `loop complete`. The completed status and `completion_promise` stop reason are the proof, not the provisional line alone.
