# Cost, Stall Protection & Health

Long-running loops fail in two expensive ways: they burn money without converging, or they spin in place repeating the same output. autoloop guards against both from the journal itself, and ships two operator commands — `doctor` and `stats` — that read the same state.

## Cost budget (`event_loop.max_cost_usd`)

Backends with usage telemetry (the pi RPC backend today) journal one `backend.usage` event per iteration with token counts and cost. Set a USD budget and the harness stops the run once accumulated journaled cost reaches it:

```toml
[event_loop]
max_cost_usd = 5.0
```

```bash
autoloop run autocode --set event_loop.max_cost_usd=5.0 "Refactor the parser"
```

The run stops with reason `cost_budget` and journals a `loop.stop` event carrying `cost_usd` and `max_cost_usd`. A budget of `0` (the default) disables the check. Backends without telemetry report zero cost, so the budget never mis-fires for them.

Because the check is journal-derived, it covers every continue path — routed events, rejected emits, and plain continues — and survives context reloads.

## Stall detection (`event_loop.stall_iterations`)

A loop that produces byte-identical output N iterations in a row is not converging; it's burning the rest of its iteration budget. Enable stall detection to stop early:

```toml
[event_loop]
stall_iterations = 3
```

After `stall_iterations` consecutive identical backend outputs the run stops with reason `stalled`, journaling how many identical outputs were seen. Empty outputs never count (backend failures and timeouts already have their own stop reasons), and `0` (the default) disables the check.

## Inspecting usage

```bash
autoloop inspect usage              # per-iteration tokens + cost for the latest run
autoloop inspect usage --run <id>   # a specific run
autoloop inspect usage --json       # machine-readable
```

## `autoloop stats`

Cross-run analytics grouped by preset, derived from the registry plus journaled usage:

```bash
autoloop stats            # table: runs, success rate, avg iterations/duration, cost
autoloop stats --json     # machine-readable
```

Use it to answer "which presets actually finish, how long do they take, and what do they cost" before reaching for a single run's journal.

## Finish notifications (`[notify]`)

Run any command when a loop ends — post to Slack, fire a webhook via `curl`, ring a bell:

```toml
[notify]
command = "curl -s -X POST -d @- https://hooks.example.com/autoloop"
on = "completed,failed"   # stop-reason classes: completed, failed, stopped
timeout_ms = 10000
```

The command receives `AUTOLOOP_RUN_ID`, `AUTOLOOP_STOP_REASON`, `AUTOLOOP_ITERATIONS`, `AUTOLOOP_PRESET`, and `AUTOLOOP_PROJECT_DIR` in its environment, plus the same fields as a JSON payload on stdin. Delivery is best-effort and journaled as `notify.sent` / `notify.failed` — a broken notifier never fails the run.

## `autoloop doctor`

Preflight and state-health diagnostics in one command:

```bash
autoloop doctor           # human-readable report
autoloop doctor --json    # machine-readable (for agents and CI)
```

Checks include:

- **node / git / backend** — runtime version, git availability, and whether the configured backend command resolves on `PATH`
- **state** — `.autoloop/` existence and writability
- **registry** — malformed `registry.jsonl` lines
- **runs** — runs marked `running` whose process is gone
- **waves** — stale `waves/active` markers that would block future parallel waves
- **worktrees** — orphaned worktrees (suggests `autoloop worktree clean`)

Exit code is `1` only when a check fails; warnings exit `0`, so it's safe to wire into scripts.
