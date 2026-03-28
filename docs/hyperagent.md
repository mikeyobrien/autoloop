# Hyperagent Review Loop

The hyperagent is a meta-level review pass that runs periodically between normal loop iterations. Its job is to improve loop hygiene — consolidating stale context, trimming noisy working files, and storing durable learnings — without directly advancing the task. In addition to raw memory and scratchpad state, the review prompt also carries a small **context pressure** summary so the hyperagent can react to memory bloat and routing instability directly.

## When it runs

The review fires **before** an iteration, not after. The scheduling check is:

```
iteration > 1 AND (iteration - 1) is divisible by review_every
```

With the default cadence this means a review runs before iteration 2, then before iteration 2 + review_every, and so on. The first iteration always runs without review.

### Default cadence

If `review.every_iterations` is not set (or set to `0`), the harness derives the cadence from the topology:

- **Topology has roles:** `review_every` = number of roles (one full rotation per review).
- **No topology / zero roles:** `review_every` = 1 (review every iteration).

## Configuration

All review keys live in the `[review]` section of `miniloops.toml`. Most review keys fall back to the corresponding `backend.*` value when unset, but `review.timeout_ms` defaults to `300000` (5 minutes) so a long task timeout does not silently make reviews hang for ages.

| Key | Default | Description |
|-----|---------|-------------|
| `review.enabled` | `true` | Enable or disable the hyperagent. Parsed as a truthy string (`true`, `1`, `yes`). |
| `review.every_iterations` | (auto) | Run a review every N iterations. `0` or unset uses the topology-derived default. |
| `review.command` | `backend.command` | Command to invoke for the review backend. |
| `review.kind` | `backend.kind` | Process kind (`pi` or `command`). Auto-detected from command name if blank. |
| `review.args` | `backend.args` | Extra arguments passed to the review command. |
| `review.prompt_mode` | `backend.prompt_mode` | How the prompt is passed: `arg` (positional argument) or `stdin`. |
| `review.timeout_ms` | `300000` | Timeout for the review process in milliseconds. Set it higher only if you intentionally want long-running reviews. |
| `review.prompt` | `""` | Inline review prompt text (takes priority over `review.prompt_file`). |
| `review.prompt_file` | `hyperagent.md` | Path (relative to project dir) to a file containing the review prompt. Only read when `review.prompt` is empty. |

## Prompt resolution

The review prompt is resolved in order:

1. `review.prompt` — inline text in `miniloops.toml`.
2. Contents of the file at `review.prompt_file` (default: `hyperagent.md` in the project directory).
3. Empty string — if neither is set and the file does not exist, no additional instructions are injected.

When a prompt file or inline text is present, it appears in the rendered review prompt under the heading **"Additional hyperagent instructions:"**.

## The `hyperagent.md` file

The default review prompt file is `hyperagent.md` at the root of the project directory. A typical hyperagent prompt looks like:

```markdown
You are the loop's meta agent.

Review the journal, topology, roles, harness instructions, loop memory, and shared working files.

Your job is to improve loop hygiene, not to finish the task directly.
You may modify runtime-facing loop files on disk when that will make the next iterations better.
Prefer bounded hygiene edits to `miniloops.toml`, `topology.toml`, `harness.md`, `hyperagent.md`, `roles/*.md`, `.miniloop/context.md`, `.miniloop/plan.md`, `.miniloop/progress.md`, `.miniloop/logs/`, and `.miniloop/docs/*.md`.
Do not edit app/product source code, tests, package manifests, `.miniloop/` state, or journal history during review.
```

This file is optional. If it does not exist, the review runs with only the built-in system prompt.

## Built-in review prompt

Regardless of the custom prompt, every review invocation receives a system prompt that includes:

- A role statement: *"You are the hyperagent meta-reviewer for this loop."*
- A bounded-permissions instruction allowing hygiene edits to runtime-facing loop files such as `miniloops.toml`, `topology.toml`, `harness.md`, `hyperagent.md`, `roles/*.md`, `.miniloop/context.md`, `.miniloop/plan.md`, `.miniloop/progress.md`, `.miniloop/logs/`, and `.miniloop/docs/*.md`.
- A constraint forbidding edits to app/product source code, tests, package manifests, generated `.miniloop/` state, or journal history during review.
- A constraint explaining that the scratchpad is projected from journal history and cannot be edited directly; the hyperagent should instead tighten prompts, trim working files, or archive stale context.
- A constraint: *"Do not emit normal loop events during review."*
- Guidance to use `miniloops memory add ...` for short durable lessons or operator notes that should persist across turns.
- The custom review instructions (if any), under **"Additional hyperagent instructions:"**.
- A **Context pressure** block summarizing current memory usage vs budget, active memory entry counts, and the number of invalid emits seen in the run so far.
- The latest backpressure note, if the loop recently rejected an invalid event.
- The current loop memory (subject to `memory.prompt_budget_chars`).
- The review trigger iteration number and latest routing event.
- The full topology rendering (same format as normal iterations).
- The current scratchpad, rendered in the compact prompt-facing form used to keep long runs under control.
- Useful `miniloops inspect` commands for the latest iteration.
- A fallback instruction: *"If no improvements are needed, store a short learning explaining why and exit cleanly."*

## Runtime environment

During a review invocation, the harness sets the following environment variables (in addition to the standard set):

| Variable | Value | Purpose |
|----------|-------|---------|
| `MINILOOPS_REVIEW_MODE` | `hyperagent` | Signals to the backend that this is a review pass, not a normal iteration. |
| `MINILOOPS_ITERATION` | Current iteration number | The iteration that triggered the review. |

Normal iterations set `MINILOOPS_REVIEW_MODE` to an empty string. The `pi-adapter` uses this to route stream logs to `pi-review.<iteration>.jsonl` instead of the normal `pi-stream.<iteration>.jsonl`.

## Allowed events

The review backend receives `__hyperreview_disabled__` as its allowed-events set and `review` as its allowed-roles set. This means:

- The hyperagent **cannot** emit normal loop events — any attempt would be rejected by backpressure validation.
- Review output may still include bounded hygiene edits to runtime-facing loop files plus `miniloops memory add ...` commands for durable notes.
- It still must not edit app/product code, tests, manifests, `.miniloop/` state, or journal history during review.

## Journal events

Each review pass produces two journal entries:

### `review.start`

```json
{
  "topic": "review.start",
  "kind": "hyperagent",
  "backend_kind": "pi",
  "command": "pi",
  "prompt_mode": "arg",
  "prompt": "<full rendered review prompt>",
  "timeout_ms": "300000"
}
```

### `review.finish`

```json
{
  "topic": "review.finish",
  "kind": "hyperagent",
  "exit_code": "0",
  "timed_out": false,
  "output": "<review output text>"
}
```

## Hot-reload after review

After the review process finishes, the harness calls `reload_loop` — re-reading runtime config, topology, harness instructions, and review prompt inputs from disk before the next task turn. This means the hyperagent can modify loop-facing instructions and configuration, and those changes take effect on the very next iteration.

## Disabling the review loop

Set `review.enabled = false` in `miniloops.toml`:

```toml
review.enabled = false
```

This completely skips the review scheduling check. No `review.start` or `review.finish` events will appear in the journal.
