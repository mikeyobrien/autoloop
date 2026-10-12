# Dashboard

The dashboard is the local operator page for a project. It lists runs by health and opens one run's status, objective, and events. This recipe reads a loop that already completed. It does not start a bundled preset from the page.

## Sub-features

- `dash-open` shows the project heading, the preset combobox, the prompt textbox, and the Start button.
- `dash-completed` expands the Completed disclosure and lists the finished run.
- `dash-detail` opens that run and shows status, objective, and `loop.complete`.
- `dash-api` returns the same run from `GET /api/runs`.

## How to get to it (user POV)

- Run `autoloop dashboard --project-dir <project>` and open the printed URL.
- Choose the `Completed` disclosure.
- Choose the run row.
- The page polls `GET /api/runs`, `GET /api/runs/:id`, and `GET /api/runs/:id/events`.

The `Start` button is a real entry point. It submits the prompt with the selected bundled preset. This recipe does not use it.

## Driving it with control-autoloop

Preconditions:

- The run-loop recipe has completed in this same session, so `loops --all --json` contains one `completed` run whose preset is `project`. Export that `run_id` as `RUN_ID`:

```sh
RUN_ID=$(node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs cli -- loops --all --json | node --input-type=module -e 'let s=""; for await (const c of process.stdin) s+=c; const done=JSON.parse(s).filter((r)=>r.status==="completed"&&r.preset==="project"); if (done.length!==1) process.exit(1); process.stdout.write(done[0].run_id);')
```

- `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs dashboard start` printed `Dashboard listening on http://127.0.0.1:` and a port.
- `doctor` then reports `dashboard.state` `up`, `dashboard.portOwnedByPid` true, and `dashboard.health.body` containing `"status":"ok"`.

- **Open the page.** Run the browser recipe below through `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs browser`. The heading `autoloop / project` is visible and a button named `Start` is visible. The closed preset list is not visible text; the ARIA snapshot must contain `option "autocode" [selected]`.
- **Open the completed run.** The recipe clicks the `Completed` summary, then the `li.run-item` whose text contains `$RUN_ID`. The heading `Run: $RUN_ID` is visible and the page text contains `Status: completed`, `Verify the login bug`, and `loop.complete`.
- **Capture the page.** The recipe writes `$AUTOLOOP_VERIFY_ROOT/evidence/dashboard/detail.png`, `detail.aria.txt`, and `detail.txt`. The screenshot shows `autoloop / project` and `Verify the login bug`. The ARIA snapshot contains `heading "autoloop / project"` and `heading "Run: $RUN_ID"`.
- **Read the API.** Run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs get dashboard /api/runs`. Exit code `0`. The `recentCompleted` array contains one object whose `run_id` is `$RUN_ID`, `status` is `completed`, and `objective` is `Verify the login bug`. Save the body to `$AUTOLOOP_VERIFY_ROOT/evidence/dashboard/runs.json`.
- **Readiness body.** Run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs get dashboard /healthz`. Exit code `0`. The body is `{"status":"ok"}`. Save it to `$AUTOLOOP_VERIFY_ROOT/evidence/dashboard/healthz.json`.

```sh
node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs browser <<EOF
server :: dashboard
goto :: /
wait heading :: autoloop / project
click summary :: Completed
click li.run-item :: $RUN_ID
wait heading :: Run: $RUN_ID
wait text :: Verify the login bug
wait text :: loop.complete
screenshot :: dashboard/detail.png
aria :: dashboard/detail.aria.txt
text :: dashboard/detail.txt
EOF
```

The heredoc is unquoted so the shell expands `$RUN_ID`.

## Gotchas

- `goto` must use `domcontentloaded`. `networkidle` never arrives while `/api/stream` is open.
- Completed is collapsed until the summary is clicked. The run id is in the DOM before that and is not visible.
- Playwright's `getByRole('group')` and `getByRole('button')` do not match the section summaries. Click `summary` via its visible text.
- The run row has no button role. Click `li.run-item` via the run id text.
- The preset combobox has no accessible name. Its selected option is `autocode`.
- Do not click `Start`. That spawns a bundled preset with the `claude` backend and does not use `verify-backend.sh`.
- The detail objective is rendered from Markdown, so the visible block has a blank line before `Verify the login bug`. Assert the text, not a single trimmed line in the detail pane.
- A favicon request may 404 in the browser console. The heading and the run detail are the proof.
