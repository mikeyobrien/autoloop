# SDK migration — baseline audit

This document captures the starting state for the autoloop → SDK split and tracks
the 27 atomic commits that get us there. Keep it updated as each commit lands.

## Migration plan

| Phase | Commits | Milestone | Tag |
|---|---|---|---|
| 0 — baseline | 1 | This doc, clean check | — |
| 1 — decouple in place | 10 | `run()` is embed-able (no workspaces yet) | `0.5.0-sdk.0` |
| 2 — workspaces + core/harness | 8 | `@mobrienv/autoloop-{core,harness}` published | `0.6.0` |
| 3 — specialty packages | 4 | presets, backends, dashboard extracted | `0.7.0` |
| 4 — docs + 1.0 | 3 | SDK docs, embed examples, frozen API | `1.0.0` |

Phase-1 checkpoints (the ones that do the heavy decoupling):

- 1.1 split `config.ts` into pure schema + fs loader
- 1.2 `AbortSignal` on `RunOptions`; CLI owns SIGINT/SIGTERM
- 1.3 introduce `LoopEvent` + `onEvent` (duplicated w/ existing `console.log`)
- 1.4 remove `console.log` from `harness/iteration.ts` + `harness/stop.ts`
- 1.5 move `harness/display.ts` → `cli/display.ts`, event-printer shim
- 1.6 move `render*` helpers out of `harness/index.ts` into `cli/render.ts`
- 1.7 `emit.ts` returns a `Result`, no more `process.exitCode`
- 1.8 `run()` becomes `async`
- 1.9 public entry at `src/index.ts` + `exports` map
- 1.10 embed smoke test asserting zero stdio leakage

Full plan prose: see commit-message body of 0.1 and the kickoff chat transcript.

## Baseline state

Captured against commit `99819c9` (main, 10 unpushed).

### Coverage

Full-repo baseline (`npm run check` at commit `99819c9` + pre-Phase-0 fixes):

```
Lines       57.13%   ( configured threshold: 50% )
Branches    81.33%   ( configured threshold: 75% )
Functions   69.40%   ( configured threshold: 60% )
Statements  57.13%
Test files  85 passed / 85
Tests       926 passed / 926
```

Hot spots for the migration (low line coverage worth watching as files move):

- `src/loops/watch.ts`  46%  — CLI-only; moves to `cli/` in 1.5/1.6 area
- `src/harness/index.ts` currently mixed — watch as we split render* in 1.6
- `src/registry/index.ts`, `src/worktree/index.ts`  0% — barrel files; ignore

### `console.*` calls outside CLI surface

67 calls in non-CLI source. Each one is a decoupling target (Phase 1).

| File | Count | Handled by |
|---|---|---|
| `src/harness/display.ts` | 26 | 1.5 (move to `cli/`) |
| `src/memory.ts` | 13 | library, keep but prefer return values; callers print |
| `src/loops/watch.ts` | 13 | CLI-only consumer; leave as-is (watch is a CLI mode) |
| `src/harness/index.ts` | 8 | 1.6 (move `render*` out) |
| `src/topology.ts` | 4 | library, replace with return values |
| `src/harness/stop.ts` | 1 | 1.4 |
| `src/harness/iteration.ts` | 1 | 1.4 |
| `src/harness/emit.ts` | 1 | 1.7 |

Everything under `src/cli/`, `src/commands/`, `src/usage.ts`, and
`src/dashboard/views/alpine-vendor.ts` (vendored JS) is out of scope.

### `process.*` side effects outside CLI surface

| File | Call | Decision |
|---|---|---|
| `src/harness/index.ts` | `process.on("SIGINT"/"SIGTERM")`, `process.kill(process.pid, signal)` | 1.2 — replace with `AbortSignal` |
| `src/harness/emit.ts` | `process.exitCode = 0/1` (3×) | 1.7 — return `Result` |
| `src/loops/watch.ts` | `process.on("SIGINT")` | CLI-only (watch mode), keep |
| `src/backend/acp-client.ts` | `process.kill(-pid, ...)` for child-process group teardown | legitimate, keep |
| `src/backend/kiro-bridge.ts` | `process.kill(-acpChildPid, "SIGTERM")` | legitimate, keep |
| `src/loops/health.ts` | `process.kill(pid, 0)` (liveness probe) | legitimate, keep |

### `harness/` cross-dir imports

Hot spots (import targets, #-refs from `src/harness/**`):

```
9× ../utils.js            → packages/core (Phase 2.2)
7× ../json.js             → packages/core (2.2)
8× ../events/*            → packages/core (2.2)
4× ../topology.js         → packages/core (2.3)
4× ../markdown.js         → packages/core (2.2)
4× ../config.js           → split: schema→core (1.1), fs→core (2.4)
3× ../tasks.js            → packages/core (2.3)
3× ../registry/harness.js → packages/core (2.4)
3× ../agent-map.js        → packages/core (2.3)
2× ../memory.js           → packages/core (2.3)
2× ../backend/kiro-bridge → packages/backends (3.2)
1× ../worktree/*          → packages/core (2.4, registry-adjacent)
1× ../isolation/*         → packages/core (2.4)
1× ../profiles.js         → packages/core (2.3)
1× ../cli/color.js        → anomaly — journal-format.ts imports CLI; invert in 1.5
```

After Phase 2, `harness/` should import only from `@mobrienv/autoloop-core`,
`@agentclientprotocol/sdk`, and node builtins.

### Pre-Phase-0 fixes folded into 0.1

Four fixes, all pre-existing flakes/leaks on a clean checkout. Rolled into the
audit commit so the baseline is actually green:

- `test/commands/list.test.ts` — leaked user-level presets via
  `$XDG_CONFIG_HOME/autoloop/presets`. Fix: isolate `XDG_CONFIG_HOME` to a
  temp dir in `beforeAll`.
- `presets/autopreset/README.md`, `presets/autodebug/README.md` — description
  first lines violated the "Use when/after" convention enforced by the list
  test. Fix: reworded to comply.
- `test/harness/automerge-chain.test.ts` — `vi.mock("src/worktree/create.js")`
  was missing `tryResolveGitRoot` (added to source later). Fix: add it to the
  mock return.
- `vitest.config.ts` — worktree + integration tests spawn git subprocesses
  and were timing out at the default 5s under parallel load (observed 4.2–4.6s
  isolated, intermittent fail in full run). Fix: bump `testTimeout` to 15s.

### Coverage-threshold drift (resolved in Phase 2.8)

`AGENTS.md` declares a ≥90% line / ≥90% branch gate. `vitest.config.ts` is
currently set to `lines: 50, branches: 75, functions: 60`. Phase 2.8 owns the
ratchet: each extracted package gets its own `vitest.config.ts` with a gate
sized to its surface (core/harness aim for 90/90; CLI-heavy packages ratchet
upward each release). Root-level config stays loose until 2.6 empties the
root `src/`.

## Checkpoint log

| # | Status | Commit |
|---|---|---|
| 0.1 | ✅ | `c442991` baseline audit |
| 1.1 | ✅ | `d9342db` split `config.ts` schema / fs |
| 1.2 | ✅ | `eb69649` `AbortSignal` on `RunOptions` |
| 1.3 | ✅ | `1bf9c2e` `LoopEvent` + `onEvent` |
| 1.4 | ✅ | `d6a87b0` drop `console.log` from `iteration.ts` + `stop.ts` |
| 1.5 | ✅ | `1ace8fc` route harness display calls via `LoopEvent`; add `cli/event-printer.ts` |
| 1.6 | ✅ | `bb1e33d` `render*` → `cli/render.ts`; drop unused `parentPort` |
| 1.7 | ✅ | `8fc1d3f` `emit.ts` returns `EmitResult`; process.* side effects moved to `main.ts` |
| 1.8 | ✅ | `42438d6` `async run()` + cascading awaits |
| 1.9 | ✅ | `012979b` public `src/index.ts` + `exports` map |
| 1.10 | ✅ | `ad82906` SDK embed smoke test |
| — | ✅ | `9cafb25` autosde follow-up: `cliPrintEvent` coverage |
| — | ✅ | version bump → `0.5.0-sdk.0` |
| 2.1 | ✅ | `2244a26` enable npm workspaces |
| 2.2 | ✅ | `45bd208` core: events/journal/markdown/json/utils/topology/config-schema |
| 2.3 | ✅ | `759b8f7` core: domain models (agent-map, tasks, memory, profiles) |
| 2.4 | ✅ | `eaa1728` core: registry + config-fs + isolation |
| 2.5 | ✅ | `6630bed` extract `packages/harness` |
| 2.6 | ✅ | `c2f1a7a` extract `packages/cli` (keeps `@mobrienv/autoloop`) |
| 2.7 | ✅ | `cf81dbc` `resolveBundleRoot` via `require.resolve` |
| 2.8 | ✅ | per-package coverage gate (core/harness → 90/90) → publish `0.6.0` |
| 3.1 | ⬜ | `packages/presets` (data-only) |
| 3.2 | ⬜ | `packages/backends` |
| 3.3 | ⬜ | `packages/dashboard` |
| 3.4 | ⬜ | release script → publish `0.7.0` |
| 4.1 | ⬜ | SDK docs |
| 4.2 | ⬜ | embed examples |
| 4.3 | ⬜ | `1.0.0` |
