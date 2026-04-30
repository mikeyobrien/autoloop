# Changelog

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
