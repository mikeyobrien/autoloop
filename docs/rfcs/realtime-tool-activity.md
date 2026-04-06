# RFC: Realtime Tool-Call Activity Capture via Claude Stream-JSON

**Slug:** `realtime-tool-activity`  
**Status:** Draft  
**Date:** 2026-04-06  
**Phase:** Design  
**Depends on:** `progressive-activity-disclosure` (ships first as v1)

---

## Summary

Add streaming execution support for Claude backends so tool-call activity (start, finish, timing) is captured in realtime from Claude's `--mode json` stream. This provides live terminal feedback during iteration execution and feeds structured tool data into journal events — replacing post-hoc regex parsing for Claude while preserving it as a fallback for non-Claude backends.

---

## Motivation

The `progressive-activity-disclosure` RFC introduces structured tool-call data on `iteration.finish` events, parsed post-hoc from the buffered `output` string via regex. This works but has three limitations:

1. **No live feedback.** `execSync` blocks the event loop; the terminal shows nothing until the iteration completes (which can take minutes).
2. **No timing data.** Post-hoc parsing can extract tool names but not per-tool durations.
3. **Fragile parsing.** Regex extraction from unstructured output is best-effort and backend-dependent.

Claude's `--mode json` emits structured, newline-delimited events including `tool_execution_start` and `tool_execution_end`. Switching from `execSync` to `spawn` for Claude backends allows the harness to consume these events in realtime.

---

## Design

### 1. Streaming Execution — `runShellCommandStreaming()`

A new async function in `src/backend/run-command.ts` alongside the existing sync `runShellCommand()`:

```ts
export async function runShellCommandStreaming(
  providerKind: string,
  command: string,
  timeoutMs: number,
  onEvent: (event: ClaudeStreamEvent) => void,
): Promise<BackendRunResult> { ... }
```

**Behavior:**
- Spawns the command via `child_process.spawn` with `{ shell: "/bin/sh", stdio: ["pipe", "pipe", "inherit"] }`.
- Reads stdout line-by-line. Each line is parsed as JSON.
- Recognized event types are dispatched to `onEvent`. Unrecognized lines are ignored.
- `text_delta` content is accumulated into an output buffer.
- On process exit, returns a `BackendRunResult` with the accumulated output — identical shape to `runShellCommand`.
- Timeout via `setTimeout` + `child.kill("SIGTERM")`, same semantics as `execSync` timeout.

**Event types parsed:**

```ts
type ClaudeStreamEvent =
  | { type: "tool_start"; name: string; argsSummary: string }
  | { type: "tool_finish"; name: string; isError: boolean; durationMs: number }
  | { type: "text_delta"; text: string }
  | { type: "turn_end" }
  | { type: "agent_end" };
```

**Mapping from Claude JSON:**

| Claude `--mode json` event | `type` field | Mapped to |
|---|---|---|
| `tool_execution_start` | `toolExecutionEvent` | `tool_start` |
| `tool_execution_end` | `toolExecutionResponseEvent` | `tool_finish` |
| `message_update` (text_delta) | `assistantMessageEvent` | `text_delta` |
| `turn_end` | `message` | `turn_end` |
| `agent_end` | `messages` | `agent_end` |

Duration is tracked internally: `tool_start` records a timestamp, `tool_finish` computes the delta.

### 2. Backend Dispatch — Claude-Only Streaming

The iteration path branches on backend kind:

```
runIteration()
  → buildBackendCommand()
  → if backend.kind === "claude":
      await runProcessStreaming(command, timeout, onEvent)  // new
    else:
      runProcess(command, timeout, kind)                     // existing sync
```

**Key change:** `runIteration` becomes `async`. This cascades to:
- `runIteration` → `async runIteration` (returns `Promise<RunSummary>`)
- `iterate` callback → `async iterate`
- `finishIteration` → `async finishIteration`
- `executeParallelWave` → `async executeParallelWave`

The async conversion is mechanical — add `async`/`await` at each call site. No logic changes. Non-Claude backends continue using synchronous `runProcess` (wrapped in a resolved promise for type consistency).

**Files touched:**
- `src/backend/run-command.ts` — add `runShellCommandStreaming`
- `src/harness/parallel.ts` — add `runProcessStreaming`, make `runProcess` return `Promise<BackendRunResult>` for Claude
- `src/harness/iteration.ts` — `async runIteration`, `async finishIteration`
- `src/harness/wave.ts` — `async executeParallelWave`
- `src/harness/stop.ts` — no async needed (post-execution)
- `src/main.ts` — top-level `await` on `iterate()`

### 3. Journal Events — `tool.start` / `tool.finish`

New system-topic journal entries emitted by the harness (not by the agent) during streaming execution:

```jsonl
{"run":"run-abc","iteration":"3","topic":"tool.start","fields":{"name":"Edit","args_summary":"src/foo.ts:42"}}
{"run":"run-abc","iteration":"3","topic":"tool.finish","fields":{"name":"Edit","args_summary":"src/foo.ts:42","duration_ms":"412","is_error":"false"}}
```

**Schema compatibility:** `FieldsEvent` with `Record<string, string>` fields — no schema change.

**System topic registration:** Add `"tool.start"` and `"tool.finish"` to `CORE_SYSTEM_TOPICS` in `emit.ts`. This prevents them from being treated as agent-emitted routing events by `latestAgentEventRecord()`.

**Batched summary on `iteration.finish`:** The `onEvent` callback accumulates tool calls into an array. After the stream completes, `appendIterationFinish` gains two new fields:

| Field | Example |
|---|---|
| `tool_calls` | `[{"name":"Edit","argsSummary":"src/foo.ts:42","durationMs":412,"isError":false}]` |
| `tool_summary` | `"4 tool calls: 2x Edit, 1x Read, 1x Bash"` |

These fields are identical to the schema defined in `progressive-activity-disclosure` — same field names, same format. The data source changes (stream events → structured capture vs. regex → best-effort), but downstream consumers (dashboard, `inspect activity`) are unaffected.

### 4. Terminal Display — Live Tool Activity

During streaming execution, tool events are rendered to stderr via the existing `log()` path in `display.ts`:

```
━━━ iteration 3/20 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ⟳ Read src/harness/types.ts
  ✓ Read src/harness/types.ts (0.2s)
  ⟳ Edit src/harness/parallel.ts
  ✓ Edit src/harness/parallel.ts (0.4s)
  ⟳ Bash npm test
  ...
──── end iteration 3 (42s) ────────────────────────────
  files: 2 changed (+15 -3)  tools: 4 calls (2x Edit, 1x Read, 1x Bash)
```

**Rules:**
- Only when `decorativeOutputEnabled()` is true (TTY).
- `tool_start`: print `⟳ {name} {argsSummary}` to stderr.
- `tool_finish`: overwrite the spinner line with `✓`/`✗` and duration.
- Non-TTY: no live output. Summary appears in `iteration.finish` fields only.
- Max 1 active spinner line. Completed tools scroll up; current tool is on the last line.

**Implementation:** New function `printToolEvent(event: ClaudeStreamEvent)` in `display.ts`, called from the `onEvent` callback.

### 5. Dashboard Integration

No new dashboard work for this RFC. The `progressive-activity-disclosure` RFC defines the dashboard rendering (collapsible `<details>` sections for file changes and tool calls on `iteration.finish` events). This RFC provides better data into the same fields. Dashboard consumers read `tool_calls` and `tool_summary` from `iteration.finish` — they don't know or care whether the data came from stream events or regex parsing.

### 6. Completion Compatibility

**No changes to completion detection.** Analysis:

- **`completedViaEvent()`** scans `allTopics` from journal. `tool.start`/`tool.finish` are registered as system topics → excluded by `latestAgentEventRecord()`. No interference.
- **`completedViaPromise()`** checks `output.includes(promise)`. The `output` string is accumulated from `text_delta` events and fully assembled before `resolveOutcome` runs. Identical behavior to `execSync`.
- **`backend.finish` / `iteration.finish`** carry full `output`. Stream accumulation produces the same string that `execSync` would return. Written to journal after stream closes — same timing.

**Key insight:** Streaming changes *when data becomes available during execution* but not *what data is available after execution*. All completion mechanisms operate on post-execution state.

### 7. `args_summary` Sensitivity

Tool arguments may contain file contents, secrets, or large data. The `argsSummary` field is:
- Truncated to 120 characters (matching `progressive-activity-disclosure` RFC).
- Built from the first/primary argument only (e.g., file path for Read/Edit, command for Bash).
- Never includes `old_string`/`new_string` content for Edit or file contents for Write.

---

## Phasing

| Phase | RFC | What ships | Backend |
|---|---|---|---|
| **v1** | `progressive-activity-disclosure` | Post-hoc regex parsing, journal fields (`tool_calls`, `tool_summary`, `files_changed`, `files_summary`), terminal footer, dashboard collapsible sections, `inspect activity` | All backends |
| **v2** | `realtime-tool-activity` (this RFC) | Streaming execution for Claude, live terminal display, per-tool journal entries (`tool.start`/`tool.finish`), timing data, same batched fields on `iteration.finish` | Claude only |

**v1 ships first.** It defines the schema and rendering that v2 feeds into. Post-hoc regex parsing becomes the fallback for non-Claude backends after v2 ships.

**v2 is additive.** It does not remove or change any v1 behavior. It adds a better data source for Claude and live terminal display. The only breaking change is `runIteration` becoming async, which is internal to the harness.

---

## Open Questions

1. **`tool_execution_start` event confirmation.** The pi-adapter doesn't parse this event. The schema is inferred from `tool_execution_end`. Needs verification against actual `claude --mode json` output before implementation. Risk: low — if absent, `tool_start` journal entries are omitted and terminal shows `tool_finish` only (post-completion display).

2. **Stdio buffering.** Claude's `--mode json` must flush newline-delimited events without stdio buffering for realtime display to work. If stdout is block-buffered, `stdbuf -oL` or PTY allocation may be needed. The pi-adapter uses Python `subprocess.PIPE` successfully, suggesting line-buffered behavior.

3. **Parallel mode interleaving.** With async iteration, parallel branches could interleave journal writes. Current parallel mode uses worktrees with separate journals, so this is safe. Non-worktree parallel mode (sequential on same journal) is not affected because only one branch executes at a time.

---

## Files Changed (Implementation Scope)

| File | Change |
|---|---|
| `src/backend/run-command.ts` | Add `runShellCommandStreaming()` |
| `src/backend/types.ts` | Add `ClaudeStreamEvent` type |
| `src/harness/parallel.ts` | Add `runProcessStreaming()`, extend `appendIterationFinish` with tool fields |
| `src/harness/iteration.ts` | Make `runIteration`/`finishIteration` async, branch on backend kind |
| `src/harness/wave.ts` | Make `executeParallelWave` async |
| `src/harness/emit.ts` | Add `tool.start`, `tool.finish` to `CORE_SYSTEM_TOPICS` |
| `src/harness/display.ts` | Add `printToolEvent()` for live terminal display |
| `src/main.ts` | Top-level await on iterate |
| `test/harness/*.test.ts` | Async test wrappers, streaming mock |

---

## Backward Compatibility

- Non-Claude backends are completely unaffected — they continue using `runShellCommand` (sync).
- `iteration.finish` gains new fields (`tool_calls`, `tool_summary`) — additive, same as v1.
- Per-tool journal entries (`tool.start`, `tool.finish`) are new topics — existing consumers that filter by known topics ignore them.
- The async conversion of `runIteration` is internal — no public API change.
- Downstream completion detection is unchanged.
