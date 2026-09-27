# autorigor

Use when you want rigor-mode engineering with each playbook lane routed to its own model and harness.

The planner classifies each slice into a playbook lane. Each lane runs on its own harness and model.

## Routing

| Role | Harness | Model | Purpose |
| --- | --- | --- | --- |
| explorer | pi | `spark/qwen3.8-flash-next` | Maps the subsystem into `how.md` |
| planner | pi | `openai-codex/gpt-6-sol` | Picks the playbook and lane, names the data shape |
| builder-opus | Claude Agent SDK | `claude-opus-5-5` | `plan.feature`, `plan.refactor` |
| builder-sol | pi | `openai-codex/gpt-6-sol` | `plan.bugfix`, `plan.hillclimb` |
| builder-astra | pi | `openai-codex/gpt-6-astra` | `plan.perf`, `plan.hard` |
| critic | pi | `xai/grok-4.7` | Independent review on a different model family |
| finalizer | pi | `openai-codex/gpt-6-sol` | Whole-task completion gate |

```mermaid
flowchart LR
  start([loop.start]) --> explorer
  explorer -- context.ready --> planner
  planner -- plan.feature / plan.refactor --> opus[builder-opus]
  planner -- plan.bugfix / plan.hillclimb --> sol[builder-sol]
  planner -- plan.perf / plan.hard --> astra[builder-astra]
  planner -- context.needed --> explorer
  opus & sol & astra -- review.ready --> critic
  critic -- review.rejected --> planner
  critic -- review.passed --> finalizer
  finalizer -- queue.advance / finalization.failed --> planner
  finalizer -- task.complete --> done([done])
```

A slice rejected twice in one lane escalates to `plan.hard`.

## Jev lane selection

Before the first iteration, [Jev](../../../../docs/reference/jev-routing.md) classifies the objective into one lane from `routes.json` and rates its complexity from 0 to 2. Code then picks the route.

| Jev answer | Route | Builder for `plan.ready` |
| --- | --- | --- |
| Complexity at or above 1.5 | `hard` | builder-astra |
| Confident lane | that lane | the lane's builder |
| Low confidence or `no_match` | `unrouted` | none; the planner emits `plan.<lane>` |

The decision is cached for the run and recorded as `routing.jev.selected` with `route` and `reason`. Jev needs `TYPESAFE_API_KEY` and sends the objective text to TypeSafe. Set `routing.jev.enabled = false` in `autoloops.toml` to have the planner choose every lane.

To see which model runs each role and the lane Jev picked for a run:

```sh
autoloop inspect topology packages/presets/presets/autorigor --format graph --run <run-id>
```

The header shows `Jev lane: <route> (<reason>)`, and edges the lane rerouted end with `(jev)`.

## Run

```sh
autoloop run autorigor "objective" --worktree
```

Requires `pi` with the `openai-codex`, `xai`, and `spark` providers configured, the `claude` CLI signed in, and `TYPESAFE_API_KEY` unless Jev routing is disabled.

## Changing a lane

Edit the role's `backend_kind`, `backend_command`, and `backend_model` in `topology.toml`. Roles without overrides use `backend.*` from `autoloops.toml`. `-b` on the command line replaces the base backend only. Role overrides still apply.

Keep each lane event routed to exactly one role. The harness picks the backend from the first role a handoff names.
