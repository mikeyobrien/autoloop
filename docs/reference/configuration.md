# Configuration Reference

All runtime configuration lives in `autoloops.toml` at the root of a loop's project directory. Keys use flat dot-notation (`section.key = value`). The legacy `autoloops.conf` format is also accepted — the harness checks for `autoloops.toml` first and falls back to `autoloops.conf`.

Configuration drives the control plane: iteration limits, backend selection, review policy, parallelism bounds, and memory budgets are all declarative settings in this file. See [Platform Architecture](../concepts/platform.md) for how configuration fits into the broader system.

Configuration is **hot-reloaded** every iteration. You can change any value mid-run and it takes effect on the next iteration without restarting.

## File format

```toml
# Comments start with #
event_loop.max_iterations = 100
backend.command = "pi"
event_loop.required_events = ["review.passed"]
```

Values can be bare strings, quoted strings, or TOML-style arrays. Arrays are internally stored as CSV and parsed back on read:

```toml
# These are equivalent:
event_loop.required_events = ["review.passed", "tests.ok"]
event_loop.required_events = review.passed,tests.ok
```

Lines without `=` are skipped with a warning. Blank lines and comment lines are ignored.

## Precedence

`autoloops.toml` > `autoloops.conf` > built-in defaults.

For preset runs, scalar/config overrides are layered on top of the selected preset:

1. built-in defaults
2. user config (`~/.config/autoloop/config.toml`, or `AUTOLOOP_CONFIG`)
3. selected preset config (`autoloops.toml` / `autoloops.conf`)
4. user preset override (`~/.config/autoloop/overrides/<preset>.toml`)
5. repo preset override (`<repo>/.autoloop/overrides/<preset>.toml`)
6. run-scoped CLI override (`--max-iterations`, `--iterations`, or `--set key=value`)

The CLI `-b`/`--backend` flag overrides backend settings at runtime (kind, command, args, prompt_mode) without changing the file. Extra backend arguments can be passed after `--` on the command line (e.g. `autoloop run autocode -b pi -- --model anthropic/claude-sonnet-4`). These are appended to the backend's argument list.

Run-scoped config overrides are also runtime-only and are reapplied after every hot reload:

```bash
autoloop run autocode --max-iterations 250 "Fix the bug"
autoloop run autocode --set backend.timeout_ms=900000 "Fix the slow bug"
```

Persistent preset overrides can be written without forking the preset:

```bash
autoloop config set --user --preset autocode event_loop.max_iterations=250
autoloop config set --repo --preset autocode event_loop.max_iterations=250
autoloop config show --preset autocode --explain
```

## Keys

### Event loop

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `event_loop.max_iterations` | int | `3` | Maximum iterations before the loop halts. |
| `event_loop.completion_event` | string | `"task.complete"` | Event that signals loop completion. Overridden by the `completion` field in `topology.toml` if present. |
| `event_loop.completion_promise` | string | `"LOOP_COMPLETE"` | Text fallback — if the model outputs this string literally, the loop treats it as completion. Used when the model cannot emit a structured event. |
| `event_loop.required_events` | list | `[]` (empty) | Events that must appear in the journal before the completion event is accepted. Prevents premature completion. |
| `event_loop.prompt` | string | `""` | Inline prompt text for the loop objective. If set, takes precedence over `prompt_file`. |
| `event_loop.prompt_file` | string | `""` | Path to a file containing the loop objective, relative to the project directory. Used when `prompt` is empty. |
| `event_loop.max_iteration_runtime` | duration | `0` (disabled) | Per-iteration runtime cap. Accepts a duration string (`"45s"`, `"90m"`, `"12h"`, `"3d"`, `"1h30m"`) or a bare millisecond integer. When set, it overrides `backend.timeout_ms` (per-role `backend_timeout_ms` and the branch-mode `parallel.branch_timeout_ms` clamp still win). Values are capped at ~24.8 days (the Node timer limit). |
| `event_loop.max_runtime` | duration | `0` (disabled) | Loop wall-clock budget, same duration grammar. Derived from the journaled `loop.start` timestamp, so it survives reloads. Checked between iterations, and the running iteration's timeout is clamped to the remaining budget so the loop never overshoots. Stops with reason `max_runtime`. Not inherited by parallel branches (they have `parallel.branch_timeout_ms`). |

Prompt resolution order: CLI prompt override > `event_loop.prompt` > `event_loop.prompt_file`.

### Backend

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `backend.kind` | string | `""` (auto) | Backend type. `"claude-sdk"` for the Claude Agent SDK session backend, `"pi"` for the Pi adapter, `"acp"` for Agent Client Protocol providers, and `"command"` for mock/test or shell-command backends. Legacy `"kiro"` is accepted as an alias for `kind = "acp"` + `provider = "kiro"`. |
| `backend.provider` | string | `"generic"` for ACP | ACP provider preset. Built-ins: `"kiro"`, `"claude-agent-acp"`, `"generic"`. Unknown values use generic ACP behavior while preserving the label. |
| `backend.command` | string | `"claude"` | Executable to invoke. For `kind = "claude-sdk"`, an optional custom Claude Code executable path. For `kind = "pi"`, this is the Pi binary path. For `kind = "acp"`, this is the ACP stdio server command (`kiro-cli`, `npx`, a local adapter path, etc.). For `kind = "command"`, any executable. |
| `backend.timeout_ms` | int | `300000` | Timeout per backend invocation in milliseconds (default 5 minutes). Fallback when `event_loop.max_iteration_runtime` is unset. |
| `backend.args` | list | provider-dependent | Backend arguments. Kiro defaults to `["acp"]`; Claude Agent ACP defaults to `["-y", "@agentclientprotocol/claude-agent-acp"]`; command backends default to `[]`. Not used by `kind = "claude-sdk"` — configuring args on a claude command keeps it on the shell path. |
| `backend.prompt_mode` | string | provider-dependent | How the prompt is passed to the backend. `"arg"` passes it as a command-line argument, `"stdin"` passes it on standard input, and `"acp"` sends it through the ACP `prompt` request. Ignored by `kind = "claude-sdk"` (prompts go over the SDK session). |
| `backend.trust_all_tools` | bool | `true` | Auto-approve tool permission requests. For `kind = "claude-sdk"`, maps to the SDK's `bypassPermissions` mode (the session equivalent of `--dangerously-skip-permissions`). For ACP, applies when the provider supports it. |
| `backend.agent` | string | `""` | ACP session mode/agent to set via `setSessionMode` when the provider supports it. |
| `backend.model` | string | `""` | Model ID. For `kind = "claude-sdk"`, passed as the SDK `model` option. For ACP, set via `unstable_setSessionModel` when the provider supports it. |

Kind auto-detection: if `kind` is empty, the harness checks whether `command` is or ends with `pi` (→ `"pi"`); then whether it is or ends with `claude` with no custom `args` (→ `"claude-sdk"`); otherwise `"command"`. Pin `kind = "command"` to force the legacy `claude -p` shell path. Use `kind = "acp"` for ACP providers, or the CLI aliases `-b claude-sdk`, `-b kiro`, `-b claude-agent-acp`, or `-b acp:<provider>:<command>`.

The `claude-sdk` backend runs each iteration as a fresh Claude Agent SDK streaming session: live control is fully supported (`autoloop control interrupt` cancels the in-flight turn; `autoloop control guide` steers it mid-turn), per-iteration token/cost telemetry is journaled as `backend.usage` (feeding `event_loop.max_cost_usd` and `autoloop inspect usage`), and the raw SDK message stream is persisted to `claude-stream.<iteration>.jsonl` in the run state dir.

**Per-role overrides.** Any of `backend.kind`, `backend.provider`, `backend.command`, `backend.args`, `backend.prompt_mode`, `backend.timeout_ms`, `backend.trust_all_tools`, `backend.agent`, `backend.model` may be overridden per role in `topology.toml` via the corresponding `backend_*` role field. Role values take precedence; unspecified role fields fall through to the global backend. See [Per-role backend overrides](topology.md#per-role-backend-overrides).

### Review (metareview)

The review pass is a separate backend invocation that runs periodically for consolidation and hygiene. Most review keys default to the corresponding backend value if not set, but `review.timeout_ms` defaults to `300000` so large task timeouts do not also make reviews hang for a long time.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `review.enabled` | bool | `true` | Enable the metareview review pass. Falsy values: `"false"`, `"0"`, `""`. |
| `review.every_iterations` | int | `0` | Run a review every N iterations. `0` means "use the number of roles in `topology.toml`" — one full role cycle between reviews. |
| `review.command` | string | *backend.command* | Backend executable for reviews. |
| `review.kind` | string | *backend.kind* | Backend type for reviews. |
| `review.args` | list | *backend.args* | Extra flags for the review backend. |
| `review.prompt_mode` | string | *backend.prompt_mode* | Prompt delivery mode for reviews. |
| `review.timeout_ms` | int | `300000` | Timeout for review invocations. Raise it only if you intentionally want long-running reviews. |
| `review.provider` | string | *backend.provider* | ACP provider preset for reviews when `review.kind = "acp"`. |
| `review.trust_all_tools` | bool | *backend.trust_all_tools* | Auto-approve ACP tool permission requests during reviews. |
| `review.agent` | string | *backend.agent* | ACP session mode/agent for reviews. |
| `review.model` | string | *backend.model* | ACP model ID for reviews. |
| `review.prompt` | string | `""` | Inline review prompt. If set, takes precedence over `prompt_file`. |
| `review.prompt_file` | string | `"metareview.md"` | Path to the review prompt file, relative to the project directory. |

Review prompt resolution: `review.prompt` > `review.prompt_file` (defaults to `metareview.md`).

When `review.kind = "acp"`, each review runs in its own fresh ACP session built from the `review.*` keys — it does not share the iteration session, so a review can target a different provider, agent, or model than the loop backend.

### Parallel

Structured parallelism stays intentionally small in v1. These keys enable the `.parallel` event protocol and bound wave execution; branch plans still come from event payloads rather than config.

Supported trigger forms:
- `explore.parallel` — exploratory fan-out that resumes the opening routing context after join
- `<allowed-event>.parallel` — dispatch fan-out for a currently allowed normal event such as `tasks.ready.parallel`

Rules and behavior:
- only the harness may emit `*.parallel.joined`
- normal parent turns get the global `Structured parallelism` prompt block when parallelism is enabled
- branch child prompts do **not** get that global metaprompt
- one wave may be active at a time, but branches inside that wave launch as concurrent child jobs before the parent joins
- wave artifacts are written under `core.state_dir/waves/<wave-id>/...` (default `.autoloop/waves/<wave-id>/...`), including per-branch logs/results plus `join.md` timing summaries

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `parallel.enabled` | bool | `false` | Enable structured parallel trigger validation and the parent-only parallel metaprompt (`explore.parallel` and `<allowed-event>.parallel`). |
| `parallel.max_branches` | int | `3` | Maximum number of branch objectives accepted from one `.parallel` trigger payload. Payloads must be markdown bullet or numbered lists with 1..N distinct items. |
| `parallel.branch_timeout_ms` | int | `180000` | Timeout budget per branch wave in milliseconds. Timed-out waves record `wave.timeout` in the parent journal. |

Example:

```toml
parallel.enabled = true
parallel.max_branches = 3
parallel.branch_timeout_ms = 180000
```

### Isolation / Worktree

Controls whether runs get their own git worktree for file-level isolation. See [Worktree Reference](../features/worktree.md) for CLI flags and merge semantics.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `worktree.enabled` | bool | `false` | Enable worktree isolation by default for this preset. Equivalent to passing `--worktree` on every run. |
| `isolation.enabled` | bool | `false` | Alias for `worktree.enabled`. Either key triggers worktree mode. |
| `worktree.branch_prefix` | string | `"autoloop"` | Prefix for worktree branch names. Branches are created as `<prefix>/<run-id>`. |
| `worktree.merge_strategy` | string | `"squash"` | How worktree branches merge back into the base branch. Overridden by `--merge-strategy` CLI flag. |
| `worktree.cleanup` | string | `"on_success"` | When to remove the worktree after the run. `"on_success"` removes only after a successful completion. |

Resolution priority: `--worktree` flag → `--no-worktree` flag → config `worktree.enabled`/`isolation.enabled` → auto-detect based on concurrent runs.

### Profiles

Profiles inject per-role prompt fragments into preset topologies. See [Profiles](../features/profiles.md) for the full directory layout and composition rules.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `profiles.default` | list | `[]` (empty) | Profile specs activated on every run unless `--no-default-profiles` is passed. Each entry is `"repo:<name>"` or `"user:<name>"`. |

The `--profile` CLI flag adds profiles on top of the defaults. Use `--no-default-profiles` to suppress the config defaults and apply only explicitly listed profiles.

### Memory

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `memory.prompt_budget_chars` | int | `8000` | Maximum characters of materialized memory injected into each iteration's prompt. |

### Harness

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `harness.instructions_file` | string | `"harness.md"` | Path to the harness instructions file, relative to the project directory. This file provides standing instructions injected into every iteration. |

### Core

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `core.state_dir` | string | `".autoloop"` | Directory for runtime state (journal, memory, tools). |
| `core.journal_file` | string | `".autoloop/journal.jsonl"` | Path to the journal file. |
| `core.memory_file` | string | `".autoloop/memory.jsonl"` | Path to the memory file. |
| `core.tasks_file` | string | `".autoloop/tasks.jsonl"` | Path to the tasks file (used by the `task` tool). |
| `core.events_file` | string | — | **Legacy alias** for `core.journal_file`. Still accepted; prefer `journal_file`. |
| `core.log_level` | string | `"info"` | Log verbosity. Valid levels: `debug`, `info`, `warn`, `error`, `none`. Overridden by `-v`/`--verbose` (sets `debug`). Exported as `AUTOLOOP_LOG_LEVEL`. |
| `core.run_id_format` | string | `"human"` | Run ID format: `"human"` for readable `<word>-<word>` ids, `"compact"` for legacy timestamp-based `run-<base36>-<suffix>`, `"counter"` for sequential `run-1`, `run-2`. |

## Full example

```toml
event_loop.max_iterations = 100
event_loop.completion_event = "task.complete"
event_loop.completion_promise = "LOOP_COMPLETE"
event_loop.required_events = ["review.passed"]

backend.kind = "pi"
backend.command = "pi"
backend.timeout_ms = 300000
# backend.args = ["--model", "anthropic/claude-sonnet-4"]

review.enabled = false
review.timeout_ms = 300000
review.every_iterations = 0

parallel.enabled = false
parallel.max_branches = 3
parallel.branch_timeout_ms = 180000

memory.prompt_budget_chars = 8000
harness.instructions_file = "harness.md"

core.state_dir = ".autoloop"
core.journal_file = ".autoloop/journal.jsonl"
core.memory_file = ".autoloop/memory.jsonl"
core.tasks_file = ".autoloop/tasks.jsonl"
# core.log_level = "info"

worktree.enabled = false
worktree.branch_prefix = "autoloop"
worktree.merge_strategy = "squash"
worktree.cleanup = "on_success"

# profiles.default = ["repo:phoenix"]
```

## Mock backend mode

For deterministic local harness testing only:

```toml
backend.kind = "command"
backend.command = "node"
backend.args = ["dist/testing/mock-backend.js"]
```

Command mode invokes the executable directly and captures stdout. It is not a supported production adapter — use Pi for real loops.

## Claude Agent SDK backend (default)

The claude-sdk backend drives Claude Code through `@anthropic-ai/claude-agent-sdk` streaming sessions instead of one-shot `claude -p` shell invocations. Each iteration runs in a fresh SDK session (one query is one conversation), so every role starts with a clean context window; metareview runs in its own dedicated session. The streaming-input channel is what enables live control mid-turn. It is the default backend: a plain `claude` command with no custom args resolves to `kind = "claude-sdk"` automatically.

```toml
backend.kind = "claude-sdk"
backend.command = "claude"          # optional custom Claude Code executable path
# backend.model = "claude-opus-4-6" # passed as the SDK model option
backend.timeout_ms = 300000
```

`backend.trust_all_tools = true` (the default) maps to the SDK's `bypassPermissions` mode — the session equivalent of the `--dangerously-skip-permissions` flag the shell path injects. The session loads the Claude Code system prompt and project settings (CLAUDE.md), matching `claude -p` behavior.

Live control: `interrupt` requests call the SDK's `interrupt()`, cancelling the in-flight turn without killing the session, and `guide` requests are additionally steered into the live turn as a queued user message — delivered at the agent's next safe boundary, on top of the journal-durable copy that reaches the next iteration prompt.

Observability: the raw SDK message stream of every iteration is persisted to `.autoloop/runs/<run_id>/claude-stream.<iteration>.jsonl` (metareviews to `claude-review.<iteration>.jsonl`), preserving full tool-call fidelity. After each iteration the harness journals a `backend.usage` event with token counts and cost from the SDK result message, feeding `event_loop.max_cost_usd` budgets, `autoloop inspect usage`, and `autoloop stats`.

To force the legacy `claude -p --dangerously-skip-permissions` shell path instead, pin `backend.kind = "command"` (configs with custom `backend.args` stay on the shell path automatically).

## Pi backend (RPC sessions)

The pi backend drives a persistent `pi --mode rpc --no-session` process over pi's JSONL RPC protocol. The harness spawns one pi process and reuses it across iterations; each iteration issues a `new_session` command so every role starts with a clean context window (the process is respawned automatically if it dies or refuses the reset). Metareview runs in its own dedicated pi RPC session. Spawn and reset round trips carry hard deadlines, so a wedged pi binary fails the iteration instead of hanging the loop.

```toml
backend.kind = "pi"
backend.command = "pi"
# backend.model = "anthropic/claude-sonnet-4"   # passed as --model
# backend.args = ["--thinking", "high"]          # appended verbatim
```

Live control: `interrupt` requests map to pi's `abort` command, cancelling the in-flight turn without killing the process, and `guide` requests are additionally steered into the live turn via pi's `steer` command — delivered before the agent's next LLM call, on top of the journal-durable copy that reaches the next iteration prompt.

Observability: the raw RPC event stream of every iteration is persisted to `.autoloop/runs/<run_id>/pi-stream.<iteration>.jsonl` (metareviews to `pi-review.<iteration>.jsonl`), preserving full tool-call and thinking fidelity. After each iteration the harness journals a `backend.usage` event with token counts, cost, and context-window usage from pi's `get_session_stats`.

Parallel waves still run pi process-per-task through the `pi-adapter` shim (`pi -p --mode json`), since wave branches execute as independent shell commands.

## ACP backend providers

ACP backends communicate with an Agent Client Protocol (ACP) stdio server over JSON-RPC 2.0. Use `backend.kind = "acp"` and select provider-specific defaults with `backend.provider`. Legacy `backend.kind = "kiro"` still works and normalizes to `kind = "acp"` plus `provider = "kiro"`.

Kiro ACP:

```toml
backend.kind = "acp"
backend.provider = "kiro"
backend.command = "kiro-cli"
backend.args = ["acp"]
backend.trust_all_tools = true
# backend.agent = "gpu-dev"
# backend.model = "anthropic/claude-sonnet-4"
```

Claude Agent ACP:

```toml
backend.kind = "acp"
backend.provider = "claude-agent-acp"
backend.command = "npx"
backend.args = ["-y", "@agentclientprotocol/claude-agent-acp"]
backend.trust_all_tools = true
```

Generic ACP provider:

```toml
backend.kind = "acp"
backend.provider = "my-provider"
backend.command = "/path/to/agent-acp"
backend.args = []
```

CLI aliases:

```bash
autoloop run autocode -b kiro "Fix the login bug"
autoloop run autocode -b claude-agent-acp "Fix the login bug"
autoloop run autocode -b acp:my-provider:/path/to/agent-acp "Fix the login bug"
```

The `trust_all_tools` key (default `true`) auto-approves ACP tool permission requests when the provider exposes them. Set it to `false` to reject tool calls. The `agent` and `model` keys are optional; when set, providers that support `setSessionMode` and `unstable_setSessionModel` receive those requests during session initialization.

### Session lifecycle

Like the pi RPC backend, ACP backends keep a stdio child process per active iteration session rather than spawning one process per invocation (only `command` backends do that). The harness uses a fresh ACP session for each iteration so role-specific prompts, agent names, and model settings do not leak conversation history across planner/builder/critic roles.

Sequence: spawn provider command → `initialize` handshake → `session/new` → optional `setSessionMode` / `unstable_setSessionModel` → iteration prompt via ACP `prompt` request → `terminate` on iteration or loop exit.

### agents.toml — per-role ACP agent routing

`agents.toml` is an ACP **agent-only** overlay. It does not influence `backend_kind`, `backend_provider`, `backend_command`, `backend_args`, `backend_prompt_mode`, `backend_timeout_ms`, or `backend_model` — those come from the global `backend.*` config or per-role overrides in `topology.toml`.

When using an ACP provider with a multi-role topology, an `agents.toml` file in the project directory can map each role to a different agent/mode. This lets you route the planner to one agent and the builder to another.

```toml
# agents.toml

[defaults]
agent = "general"           # fallback for any role not listed below

[preset.autocode]
default = "code-agent"      # default for all autocode roles
builder = "gpu-dev"         # override for the builder role specifically
critic = "code-reviewer"    # override for the critic role
```

Resolution order (most specific wins):
1. `preset.<name>.<role>` — role-specific agent for a preset
2. `preset.<name>.default` — default agent for a preset
3. `defaults.agent` — global fallback
4. `topology.toml` `backend_agent` on the role — used when no `agents.toml` resolves a value
5. `backend.agent` config key — used when neither `agents.toml` nor a role-level `backend_agent` is set

`agents.toml` wins over a role's `backend_agent` only when it resolves a non-empty value; otherwise the role's `backend_agent` is used.

The resolved agent name is passed to ACP providers that support `setSessionMode` at the start of each iteration session.

## Preset patterns

All `auto*` presets share the same structure. The only value that typically varies per preset is `event_loop.required_events`, which names the quality-gate event for that workflow:

| Preset | Required event(s) |
|--------|-------------------|
| autocode | `review.passed` |
| autospec | `research.ready`, `design.ready`, `spec.ready` |
| autosimplify | `simplification.verified` |
| autodoc | `doc.checked` |
| autofix | `fix.verified` |
| autoperf | `perf.measured` |
| autoqa | `surfaces.identified` |
| autoresearch | `experiment.measured` |
| autoreview | `review.checked` |
| autosec | `findings.reported` |
| autotest | `tests.passed` |
| autoideas | `analysis.validated` |

See `presets/<preset>/autoloops.toml` for complete files.
