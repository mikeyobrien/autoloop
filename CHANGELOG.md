# Changelog

## [Unreleased]
### Added
- **`autowiki` preset — OKF LLM-wiki pipeline.** A bundled preset that ingests a queue of
  hand-curated source URLs into an OKF-conformant LLM wiki of cross-linked markdown concept
  pages (Karpathy "LLM Wiki" pattern; openable in Obsidian). One task = one source URL, each
  flowing clean → write → summarize → synthesize → compare → lint → index → merge on its own
  branch. The vault is scaffolded by the loop itself (`okf-init.sh`), and querying/maintaining
  the built wiki ship as agent-neutral user skills (`query-wiki`, `maintain-wiki`). See
  `packages/presets/presets/autowiki/README.md`.
- **`backend.disallowed_tools` (claude-sdk).** Comma-separated tool names to remove from the
  agent entirely — a hard block that applies even under `bypassPermissions`, where permission
  deny rules don't. Empty by default. `autowiki` uses it to drop the built-in
  `WebFetch`/`WebSearch` so all source capture goes through its dedicated cleaner tooling.
- **`{{PRESET_DIR}}` template placeholder + hook template expansion.** `{{PRESET_DIR}}`
  resolves to the absolute preset/config dir (holding `roles/`, `scripts/`, `hooks/`), letting
  a role or hook reference preset-bundled files by path. The `hooks.*` commands (`pre_run`,
  `pre_iteration`, `post_iteration`, `post_run`) now receive the same placeholder expansion as
  role prompts, so a hook can invoke a preset-bundled script (e.g. a deterministic `pre_run`
  bootstrap) without hardcoding paths.

### Fixed
- **`backend.usage`/`hook.output` no longer clobber event routing.** These per-iteration
  telemetry/observability emits were being treated as routing events, overwriting the routing
  position every cycle — collapsing topology backpressure to all-roles freedom after the first
  iteration and letting the agent self-route past required intermediate steps. They are now
  excluded from routing so topology-driven flows (e.g. `autowiki`) stay gated.
- **`--chain` now roots at the target project dir instead of the bundled presets dir.**
  `looksLikeProjectDir` used CommonJS `require("node:fs")` inside the ESM build, so every
  call threw `ReferenceError: require is not defined`, the `catch` returned `false`, and the
  function always reported "not a project dir." As a result `autoloop run --chain <presets>
  <project-dir>` (and chain runs from a project cwd) ignored an explicit/cwd `autoloops.toml`
  and always fell back to `defaultChainProjectDir` → the bundled-presets dir, misrooting chain
  state (`.autoloop/chains`, runs) into the install instead of the user's repo. Fixed by
  importing `statSync` from `node:fs` via ESM. Affects both source and npm installs
  (`@mobrienv/autoloop-cli`'s published dist carried the same bug).

## [0.8.0] - 2026-06-12
### Added
- **Runtime budgets.** Two new duration keys under `[event_loop]`, accepting duration strings (`"3d"`, `"12h"`, `"1h30m"`) or millisecond integers: `max_iteration_runtime` caps a single iteration's runtime (overriding `backend.timeout_ms` — iterations can now legitimately run for days while waiting on long-running workflows or PR reviews), and `max_runtime` bounds the whole loop's wall-clock time, stopping with reason `max_runtime`. The loop guard is journal-derived from the `loop.start` timestamp (survives reloads, covers every continue path), each iteration's timeout is clamped to the remaining loop budget so the run never overshoots, and `autoloop doctor` gains a `runtime limits` check (invalid durations, iteration cap > loop budget, ~24.8-day Node timer cap).
- **Claude Agent SDK backend (`kind = "claude-sdk"`) — now the default for Claude.** Iterations run through a `@anthropic-ai/claude-agent-sdk` streaming session instead of one-shot `claude -p` shells: live interrupt (`autoloop control interrupt`) and mid-turn steering (`autoloop control guide`) like the pi backend, per-iteration `backend.usage` token/cost telemetry (so `event_loop.max_cost_usd` budgets work out of the box), and the raw SDK message stream persisted to `claude-stream.<iteration>.jsonl` per iteration. Each iteration gets a fresh session (clean context per role); metareviews run in their own dedicated session; parallel-wave tasks fall back to one-shot headless `claude -p` shells. `backend.model` maps to the SDK model option and `backend.command` to a custom Claude Code executable path.
- **Agent-ergonomics contract.** Every CLI error path now writes to stderr and exits non-zero (0 success, 1 user-input error, 2 environment error — dictionary documented in `--help` and `capabilities`). Mistyped commands (`autoloop staus`), subcommands (`memory lst`, `task ad`, `config shwo`), and flags (`loops --jsno`) fail fast with a "Did you mean" correction instead of being misread as preset names or dumping usage with exit 0.
- **`autoloop triage [--json]`.** One-call status mega-command for agents and operators: active runs, health, doctor checks, per-preset stats, and copy-paste recommended next commands — equivalent to `loops` + `loops health` + `doctor` + `stats` in a single invocation.
- **`autoloop capabilities`.** Machine-readable CLI contract: command list with JSON/mutating annotations, exit-code dictionary, env vars, and the stdout/stderr output contract. Deterministic output.
- **`autoloop robot-docs`.** Paste-ready in-tool agent handbook — canonical first commands, JSON-capable read surfaces, live-run controls, contract, and gotchas. No external docs lookup needed.
- **`autoloop --version` / `-V` / `version`** prints the CLI version (previously interpreted as a preset name).
- **`autoloop help [command]`** word-form alias for `--help`, with per-command help re-dispatch (`autoloop help loops`).
- **Bare `autoloop`** now prints the full usage instead of a `run` error.
- **`autoloop config unset`.** Removes a user/repo preset override key (was advertised in `--help` but unimplemented). Prunes empty sections from the override file.
- **Cost budget stop condition.** Set `event_loop.max_cost_usd` and the harness stops the run (reason `cost_budget`) once accumulated journaled cost from `backend.usage` events reaches the budget. Journal-derived, so it covers every continue path and survives context reloads. Disabled by default (`0`).
- **Stall detection.** Set `event_loop.stall_iterations = N` and the harness stops the run (reason `stalled`) after N consecutive byte-identical backend outputs — a loop that repeats itself is burning the rest of its iteration budget. Disabled by default (`0`).
- **`autoloop inspect usage`.** Per-iteration token counts and cost for a run, aggregated from `backend.usage` journal events (`--run`, `--json` supported). Backed by new `collectUsage`/`formatUsage` helpers in `@mobrienv/autoloop-core`.
- **`autoloop stats`.** Cross-run analytics grouped by preset: run counts, success rate, average iterations and duration, and total journaled cost. `--json` for agents and scripts.
- **`autoloop doctor`.** Environment and state-health diagnostics: node/git/backend availability, `.autoloop` writability, malformed registry lines, runs marked `running` whose process is gone, stale wave markers, and orphaned worktrees. Exit code 1 only on failures; `--json` supported.
- **"Did you mean" suggestions.** Mistyped preset names and `inspect` targets now suggest the closest match (shared Levenshtein-based helper in the CLI).
- **`autoloop init`.** Project onboarding scaffold: writes a fully commented starter `autoloops.toml`, adds `.autoloop/` to `.gitignore` in git repos, and `--preset <name>` scaffolds a runnable custom preset (config, harness.md, 2-role topology, role prompts, README). Never overwrites existing files.
- **`autoloop chain run --dry-run`.** Prints the resolved execution plan (steps, preset dirs, backend overrides) plus budget validation without running anything; `--json` for machines; exit 1 on budget violations. Explicit chains are now budget-enforced at the root too: `max_steps` is pre-checked and `max_runtime_ms` is enforced between steps, stopping with outcome `budget_exceeded` (journaled via a `failed_reason` field on `chain.complete`).
- **`autoloop worktree diff <run-id>`.** Preview a worktree's changes against its base before merging: diffstat summary by default, `--patch` for the full patch, `--json` for the structured result (new `diffWorktree` in `@mobrienv/autoloop-core/worktree`).
- **Task priorities + soft tasks.** `task add --priority <high|normal|low>` and `--soft`; open tasks sort by priority in prompts and listings, and the completion gate now blocks only on non-soft tasks (soft tasks are advisory). Fully backward compatible with existing `tasks.jsonl` files.
- **Memory lifecycle: `memory compact` and `memory prune`.** `compact` tombstones exact-duplicate learnings (keeping the oldest); `prune --max-age <days>` tombstones stale learnings (never preferences or meta). Both are append-only via the existing tombstone mechanism.
- **Finish notifications.** Configure `[notify] command = "..."` (with `notify.on` stop-reason classes `completed,failed,stopped` and `notify.timeout_ms`) and the harness runs it when a loop ends, passing `AUTOLOOP_RUN_ID`/`AUTOLOOP_STOP_REASON`/`AUTOLOOP_ITERATIONS`/`AUTOLOOP_PRESET`/`AUTOLOOP_PROJECT_DIR` env vars plus a JSON payload on stdin. Best-effort, journaled as `notify.sent`/`notify.failed`.
- **Live dashboard updates.** New `/api/stream` SSE endpoint pushes run-list updates when the registry changes (fs.watch with polling fallback, debounce, keepalives); the dashboard UI consumes it via `EventSource` and falls back to polling on error.
- **`--json` for operator commands.** `loops [--all]`, `loops show`, `loops artifacts`, `loops health`, and `list` all support `--json` for agents and scripts. Human output is unchanged.

### Changed
- **Default backend behavior change.** A plain `claude` backend (the default, or `-b claude`) now resolves to the new `claude-sdk` backend instead of the `claude -p` shell path. The legacy shell path is unchanged and still available: pin `backend.kind = "command"` (or `--set backend.kind=command`), and configs with custom `backend.args` automatically stay on the shell path since the SDK doesn't take CLI args.

### Fixed
- **Live steering now reaches the in-flight turn.** `autoloop control guide --no-interrupt` queued the request but never signaled the harness, so live steer could only apply at the next iteration boundary (where no turn is active) — for every backend. The CLI now pokes the harness on every guide request; the signal only triggers a control-queue drain, and the backend adapter decides whether to steer or interrupt.

- **`autoloop run <preset> --help` no longer starts a loop.** `--help`/`-h` anywhere among the run args shows usage instead of burning iterations against the backend.

## [0.7.4] - 2026-05-07
### Fixed
- **Harness: fresh ACP session per iteration.** Previously the kiro backend reused a single session across iterations and flipped modes via `setSessionMode()` — context from the finder role bled into the doer/checker/closer roles. The iteration loop now terminates and recreates the ACP session each pass, matching the AgentSpacesDesktop harness's per-iteration session lifecycle so every role gets an independent context window.

## [0.7.3] - 2026-05-07
### Publish pipeline hardening (no runtime changes)
- Per-workspace `publish-npm.yml` loop: failures abort the job loudly instead of being swallowed by `|| true`. The previous behavior masked the v0.7.1 partial-publish where workspace packages 404'd on the OIDC PUT and only the meta package shipped.
- Workspace packages now publish with `--provenance` (trusted publishing configured on npmjs.org for each `@mobrienv/autoloop-*` package).
- New "Verify workspace deps resolve" step runs before the root publish and fails the job if any cross-workspace dep the root pins isn't fetchable on the registry.
- Each workspace `package.json` now declares `repository` (with `directory` pointing at the subpath) so npm's sigstore provenance verification can match the bundle's source claim.

(0.7.2 was tagged but never published — the OIDC config for workspace packages still pointed at `mobrienv` instead of `mikeyobrien` at tag time, so CI failed safely without shipping anything.)

## [0.7.0] - 2026-04-30
### Phase 3 of the SDK migration: specialty packages
- **New workspace packages** (alongside existing `core`, `harness`, `cli`):
  - `@mobrienv/autoloop-presets` — data-only bundle of the 16 shipped preset definitions, resolved via `require.resolve`.
  - `@mobrienv/autoloop-backends` — shell + ACP/kiro backend drivers, decoupled from harness via a minimal `BackendPaths` surface.
  - `@mobrienv/autoloop-dashboard` — Hono-based read-only runs dashboard, consumed by the CLI via dependency injection (`listPresets`).
- **Async-native kiro path**: the iteration loop became async end-to-end, replacing the sync bridge (Worker thread + SharedArrayBuffer + Atomics). Deleted `kiro-bridge.ts`, `kiro-worker.ts`, and `kiro-ipc.ts` from the backends package (-251 LOC). ACP sessions are now driven directly via `sendAcpPrompt`.
- **Core additions**: `@mobrienv/autoloop-core/runs-health` (`categorizeRuns`, `policyForPreset`, `HealthResult`) and `bundled-presets.ts` (`bundledPresetsRoot`) moved in to keep the dashboard / CLI split clean.
- **Release tooling**: new `bin/release <version>` script bumps all workspaces in one pass (versions + cross-workspace dep pins + plugin.json). `npm run build` now builds all workspaces, then root. `publish-npm.yml` publishes `packages/*` first, then the root package.

### Breaking
- `@mobrienv/autoloop-harness` no longer exposes `./backend/*` subpath exports. Import backend helpers from `@mobrienv/autoloop-backends` instead.
- `KiroSessionHandle` (the worker-thread handle) is replaced by `AcpSession` on `LoopContext.kiroSession`.
- `setKiroSessionMode` / `signalInterrupt` / `initKiroSession` / `terminateKiroSession` are removed — use `acp-client` primitives directly.

## [0.6.0] - 2026-04-25
### SDK migration — phase 2: npm workspaces + core/harness/cli split
- Enabled npm workspaces; extracted `@mobrienv/autoloop-core`, `@mobrienv/autoloop-harness`, and `@mobrienv/autoloop-cli`.
- Per-package coverage gates; per-package `tsc` builds; `resolveBundleRoot` now uses `require.resolve`.

## [0.5.0] - 2026-04-18
### SDK migration — phase 1: decouple in place
- `run()` is now async and embed-able; SDK consumers get a `LoopEvent` stream via `onEvent` with zero stdio leakage.
- `emit.ts` returns an `EmitResult` instead of mutating `process.exitCode`.
- `RunOptions.signal` (`AbortSignal`) threaded through the loop; CLI owns SIGINT/SIGTERM handling.
- Split `config.ts` into a pure schema + a filesystem/env layer.
- Harness no longer writes to `console.*`; the CLI owns all terminal output.
- Public entry at `src/index.ts` + `exports` map; published `0.5.0-sdk.0` during the checkpoint sequence.

## [0.4.0] - 2026-04-10
### Added
- **Inspect explorer**: richer journal timeline, artifact summaries, and dashboard explorer views for digging into completed runs.
- **Autopreset preset**: new `autopreset` workflow for generating user-local presets from natural-language operator intent.
- **AutoQA hardening**: adversarial hands-on driving, UX critique, and tool auto-discovery to make evaluation loops more concrete.
- **Verbose ACP streaming**: backend plumbing for richer live streaming and worker synchronization during ACP-backed runs.
- **Claude Code integration**: bundled Claude Code plugin metadata for launch-ready operator surfaces.

### Changed
- **Default backend update**: bundled presets now default to Claude instead of Pi for a more ready-to-run out-of-the-box path.
- **Dashboard operator polish**: recent runs sort newest-first, cap long sections with show-more controls, and display clearer project labeling.

### Fixed
- **Backend shutdown/interrupt handling**: improved stderr draining, foreground Ctrl-C behavior, and detached-process cleanup for backend workers.
- **Inspect/dashboard safety**: fixed error counting and hardened symlink/regex/path handling around artifact and inspect surfaces.
- **Worktree/run reliability**: prevented stuck runs caused by signal/dead-PID edge cases.

### Docs
- Refreshed README positioning around dashboard, inspect, worktrees, and launch-ready product surfaces.
- Added new RFCs for dashboard, artifact rendering, and verbose streaming.

## [0.3.0] - 2026-04-09
### Added
- **Debugging preset**: new `autodebug` preset for structured reproduce -> investigate -> fix -> verify loops.
- **Dashboard operator polish**: recent runs sort newest-first, capped lists with show-more controls, and clearer project labeling.
- **Default backend update**: bundled presets now default to Claude instead of Pi for a more ready-to-run out-of-the-box path.

### Docs
- Refreshed README positioning around dashboard, inspect, worktrees, and launch-ready product surfaces.
- Corrected CLI docs to point bundled preset resolution at `presets/<name>/`.
- Updated release docs to use version placeholders, require changelog updates, and call out separate GitHub release-note creation.

## [0.2.1] - 2026-04-07
### Added
- **Dashboard**: Visual indicators (checkmark/green badge) for successfully merged worktree runs.

## [0.2.0] - 2026-04-07

### Features

- **Dashboard**: Alpine.js SPA with events API, iteration display (X/N), review event rendering, worktree workspace view, structured prompt rendering, Markdown rendering for event details, event summary enrichment, and merged-success indicators
- **Worktree isolation**: Full worktree creation lifecycle, merge/clean commands, orphan detection, journal scanning, merge strategy CLI override, automerge lifecycle, and conflict detection with remediation hints
- **Layered config**: Precedence system (defaults < user < project < CLI), per-key provenance tracking, `config show --json`, and config path resolution
- **Presets**: Scan `~/.config/autoloop/presets/` for user presets, preset-aware health states and supervision policy, action-oriented preset descriptions, and preset categories
- **Profiles**: Profile support for preset role tuning
- **Chains**: Chain-aware operator surfaces with merged registry discovery, chain handoff with runId propagation, category-aware isolation decision model, and inline chain option propagation
- **Kiro backend**: ACP client module, Kiro agent role mapping, ACP session lifecycle and sync iteration dispatch
- **Task management**: Task system and autopr preset
- **Human-readable run IDs**
- **Automerge preset** with `--automerge` chain sugar and cross-run journal merge
- **Dashboard command** with Hono server and JSON API
- **Inspect topology** target with terminal/json/graph formats
- **Runs clean** command with age-based retention
- **Developer toolchain**: `bin/dev` dispatcher, lint/format/code coverage pre-commit gates, git hooks
- **Isolation mode resolution** and run-scoped state directories
- Print last 200 lines of backend stdout after each iteration
- Show effective backend args in `autoloop loops show`
- Show Started At column in `autoloop loops list`
- BASE column in worktree list output
- Compact worktree indicators in list views
- Origin-check middleware and input validation for dashboard

### Fixes

- Remote-first base comparison for autopr to prevent inherited unpublished commits
- Honor `XDG_CONFIG_HOME`/`APPDATA` in user config path resolution
- Correct `--automerge` projectDir derivation; suppress worktree for planning steps
- Skip inline automerge for chain-triggered runs
- Prefer routed events over completion promise; prevent completion_promise from overriding invalid routed events
- Gate decorative display banners on tty output
- Detect and reclassify killed runs that remain as active in dashboard
- Resolve run-scoped and worktree journals in dashboard events API
- Rewrite run-scoped prompt paths
- Provide fallback git identity for worktree merges
- Harden ACP session lifecycle and worker synchronization
- Make claude backend defaults portable
- Let autofix exit cleanly when no bug is found
- Show created timestamps in inspect memory markdown output

### Refactoring

- Move `resolveTasksFile` to config.ts for consistency
- Extract `resolveOutcome` and progress closure in iteration.ts
- Extract `DerivedRunContext` to deduplicate prompt derivation
- Simplify `buildLoopContext` and `reloadLoop` in config-helpers
- Deduplicate helpers across worktree, inspect, topology, and journal modules
- Rename `MINILOOPS_*` env vars to `AUTOLOOP_*` across runtime, tests, and docs

## [0.1.4] - Previous release
