# Embedding autoloop as an SDK

Starting with `0.7.0`, `@mobrienv/autoloop` ships an embeddable `run()` alongside the CLI. SDK consumers can drive a loop from their own Node process, own cancellation via `AbortSignal`, and subscribe to a structured `LoopEvent` stream instead of parsing terminal output.

The CLI is still the primary way to operate autoloop. This guide is for programs that need to host loops directly — dashboards, one-off scripts, custom schedulers, test harnesses.

## Install

```sh
npm install @mobrienv/autoloop
```

Requires Node `>=18`. The root package re-exports the public SDK surface from the `@mobrienv/autoloop-harness` workspace; you do not import from the individual `packages/*` directly.

## Minimal embed

```ts
import { run, type LoopEvent } from "@mobrienv/autoloop";

const controller = new AbortController();

const summary = await run(projectDir, prompt, "autoloop", {
  signal: controller.signal,
  onEvent: (e: LoopEvent) => console.log(e.type),
});

console.log(summary.stopReason, summary.iterations);
```

`projectDir` is the repo (or sub-tree) the loop operates on. `prompt` is the override prompt passed to the backend (`null` falls back to the preset's default). `selfCommand` is the shell fragment the harness invokes to re-enter itself when iterating — pass `"autoloop"` when the CLI is on `$PATH`, or an absolute path to the binary otherwise.

## `run()` signature

```ts
function run(
  projectDir: string,
  promptOverride: string | null,
  selfCommand: string,
  runOptions: RunOptions,
): Promise<RunSummary>;
```

`RunSummary` is:

```ts
interface RunSummary {
  iterations: number;
  stopReason: string;
  runId?: string;
}
```

The returned `stopReason` is one of:

- **Success** (`completeLoop` path): `completion_event`, `completion_promise`, `verdict_exit`, `verdict_takeover`.
- **Stop** (non-fatal): `max_iterations`, `interrupted`, `parallel_wave_failed`, `parallel_wave_timeout`.
- **Failure**: `backend_failed`, `backend_timeout`.

Callers that want a single "did this run succeed" check should test against the success set (or against the derived registry status `"completed"`, which is the label the dashboard and `autoloop loops` use — distinct from the `stopReason` value returned here).

## `RunOptions`

Every field is optional. Names and semantics mirror the CLI flags they parallel.

| Field               | Type                          | Notes                                                                    |
|---------------------|-------------------------------|--------------------------------------------------------------------------|
| `workDir`           | `string`                      | Override the working directory. Defaults to `projectDir`.                |
| `backendOverride`   | `Record<string, unknown>`     | Partial backend config merged over the preset's `[backend]`.             |
| `logLevel`          | `string \| null`              | `"debug"`, `"info"`, `"warn"`, `"error"`.                                |
| `prompt`            | `string \| null`              | Alternative to `promptOverride` for callers that prefer `RunOptions`.    |
| `chain`             | `string \| null`              | Chain name or inline `"foo,bar"` list.                                   |
| `trigger`           | `"cli" \| "chain" \| "branch"`| Launch metadata. SDK callers usually leave this as the default `"cli"`.  |
| `parentRunId`       | `string`                      | Set when this run is a child of another run.                             |
| `profiles`          | `string[]`                    | Active profile fragments.                                                |
| `noDefaultProfiles` | `boolean`                     | Skip auto-applied default profiles.                                      |
| `worktree`          | `boolean`                     | Force worktree isolation on.                                             |
| `noWorktree`        | `boolean`                     | Force worktree isolation off.                                            |
| `isolationMode`     | `string`                      | Raw isolation mode override.                                             |
| `mergeStrategy`     | `string`                      | `"squash"`, `"merge"`, or `"rebase"` for automerge.                      |
| `automerge`         | `boolean`                     | Auto-merge the worktree on success.                                      |
| `keepWorktree`      | `boolean`                     | Skip worktree cleanup at end of run.                                     |
| `signal`            | `AbortSignal`                 | Caller-owned cancellation. See below.                                    |
| `onEvent`           | `(e: LoopEvent) => void`      | Structured event listener. See below.                                    |

### Cancellation with `signal`

When `signal` is provided, the SDK caller owns process-level signal handling. The harness only listens to that `AbortSignal` for graceful teardown — it does **not** install `process.on("SIGINT")` or `SIGTERM` handlers. Abort triggers best-effort ACP termination, registry stop, worktree status flip to `failed`, and removal of the active-wave marker.

```ts
const controller = new AbortController();
process.on("SIGINT", () => controller.abort());

const summary = await run(projectDir, null, "autoloop", {
  signal: controller.signal,
});
```

Without a signal, the harness runs to completion and nothing intercepts Ctrl-C on the caller's behalf.

### Listening with `onEvent`

`onEvent` is invoked alongside the harness's existing terminal output. SDK consumers can drive custom UIs from this stream (or ignore display variants entirely). See the [`LoopEvent`](#loopevent-variants) reference below.

## `LoopEvent` variants

The event envelope is a discriminated union on `type`. Variants are grouped into two informal families:

**Structural** — SDK consumers usually care about these:

| `type`            | Payload                                                                    |
|-------------------|----------------------------------------------------------------------------|
| `log`             | `{ level: string; message: string }`                                       |
| `iteration.start` | `{ iteration: number; maxIterations: number; runId: string }`              |
| `loop.finish`     | `{ iterations: number; stopReason: string; runId: string }`                |

**Display-requested** — the harness asks the caller to render something:

| `type`               | Payload                                                                                                                              |
|----------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| `iteration.banner`   | `{ iteration; maxIterations; allowedRoles: string[]; recentEvent: string; allowedEvents: string[]; lastRejected?: string }`          |
| `iteration.footer`   | `{ iteration: number; elapsedS: number }`                                                                                            |
| `progress`           | `{ runId; iteration; recentEvent; allowedRoles; emittedTopic?; outcome }`                                                            |
| `review.banner`      | `{ iteration: number }`                                                                                                              |
| `backend.output`     | `{ output: string; maxLines?: number }`                                                                                              |
| `failure.diagnostic` | `{ output: string; stopReason: string }`                                                                                             |
| `summary`            | `{ runId; iterations; stopReason; journalFile; memoryFile; reviewEvery; toolPath }`                                                  |

The CLI's `event-printer` renders all variants; SDK consumers typically filter down to the structural set.

## Re-exported helpers

The root package also re-exports a narrow slice of configuration and event types for consumers that want to inspect merged config or type their own event handlers:

```ts
import {
  loadProjectConfig,
  parseConfigToml,
  configDefaults,
  configGet,
  configGetInt,
  configGetList,
  emit,
  run,
  runParallelBranchCli,
  type Config,
  type LayeredConfig,
  type EmitResult,
  type LoopEvent,
  type LoopEventEmitter,
  type LoopContext,
  type RunOptions,
  type RunSummary,
  type TriggerSource,
  type Verdict,
  type VerdictKind,
} from "@mobrienv/autoloop";
```

`loadProjectConfig(projectDir)` returns the merged `LayeredConfig` for a project. `configGet`/`configGetInt`/`configGetList` read values from it with defaults. `parseConfigToml` parses a TOML string into a raw `Config`.

## See also

- [CLI reference](../reference/cli.md) — flags that map onto `RunOptions`.
- [Platform architecture](../concepts/platform.md) — how the harness, presets, backends, and dashboard fit together.
- [SDK migration notes](../sdk-migration.md) — what changed during the 0.5 → 0.7 transition.
