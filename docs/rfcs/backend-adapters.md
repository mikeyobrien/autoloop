# RFC: First-Class Backend Adapters

**Slug:** `backend-adapters`  
**Status:** Draft  
**Date:** 2026-04-06  
**Phase:** Design  
**Depends on:** none (foundational layer)

---

## Summary

Extract backend execution into a pluggable adapter architecture. Define a `BackendAdapter` interface with adapter resolution/registry, a normalized invocation model, a push-based event parser, a backend-agnostic event union, a generic async executor, and a typed capability model. Migrate the harness from the current `execSync`/`runShellCommand()` path to spawned async execution behind the adapter boundary. This RFC is the foundational layer that `realtime-tool-activity` and `progressive-activity-disclosure` build on.

---

## Motivation

The current backend architecture has **zero polymorphism**. Backend "kinds" are dispatched via string checks (`spec.kind === "pi"`, `mockBackend()`) inside `buildBackendShellCommand()` and `normalizeProviderKind()`. All backends share the same `execSync` → `BackendRunResult` path with a 100 MB buffer limit and no streaming. This makes it impossible to:

1. Add structured output parsing for specific backends (e.g., Claude `--mode json`).
2. Stream output incrementally during execution.
3. Expose backend-specific capabilities to the harness without if/else chains.
4. Test backends in isolation from the shell execution path.

A first-class adapter interface decouples "what to run and how to parse it" from "how to run it", enabling incremental migration to async execution and structured event parsing.

---

## Design

### 1. BackendAdapter Interface

The central abstraction. Each backend provides an adapter implementing this interface:

```typescript
interface BackendAdapter {
  /** Unique adapter name (e.g., "claude", "text", "pi"). */
  name: string;

  /** How the adapter's stdout should be interpreted. */
  outputMode: "text" | "ndjson";

  /** Declared capabilities — consumed by the executor and harness. */
  capabilities: BackendCapabilities;

  /**
   * Build the concrete invocation from a backend context.
   * Returns a normalized command/args/env/stdin structure.
   */
  buildInvocation(ctx: AdapterContext): BackendInvocation;

  /**
   * Optional: create a parser for incremental output.
   * Only meaningful when outputMode is "ndjson" or the adapter
   * wants to extract structure from text output.
   */
  createParser?(): BackendEventParser;
}
```

**File:** `src/backend/adapters/types.ts`

### 2. AdapterContext — Narrowed Input

The current `BackendCommandContext` passes the full `LoopContext` into command building. Adapters should not see topology, completion config, parallel settings, etc. The adapter receives a narrowed context:

```typescript
interface AdapterContext {
  spec: BackendSpec;
  prompt: string;
  paths: {
    projectDir: string;
    workDir: string;
    stateDir: string;
  };
  runtimeEnv: Record<string, string>;
}
```

A thin adapter at the call site extracts `AdapterContext` from `BackendCommandContext`:

```typescript
function toAdapterContext(ctx: BackendCommandContext): AdapterContext {
  return {
    spec: ctx.spec as BackendSpec,
    prompt: ctx.prompt,
    paths: {
      projectDir: ctx.loop.paths.projectDir,
      workDir: ctx.loop.paths.workDir,
      stateDir: ctx.loop.paths.stateDir,
    },
    runtimeEnv: parseEnvLines(ctx.runtimeEnv),
  };
}
```

**Backward compatibility:** `BackendCommandContext` is unchanged. The narrowing is internal to the adapter boundary.

### 3. BackendInvocation — Normalized Command Structure

What an adapter produces. Decouples command construction from execution:

```typescript
interface BackendInvocation {
  /** The executable path or command name. */
  command: string;

  /** Argument array (not shell-escaped — the executor handles quoting). */
  args: string[];

  /** Environment variables to set for the child process. */
  env: Record<string, string>;

  /** Working directory. Defaults to project dir if omitted. */
  cwd?: string;

  /** If provided, piped to the child's stdin. */
  stdin?: string;
}
```

**Key change from current architecture:** The current `buildBackendShellCommand()` returns a single shell string with embedded env exports, signal traps, and prompt piping. `BackendInvocation` separates these concerns — env goes in `env`, stdin goes in `stdin`, signal handling goes in the executor.

**File:** `src/backend/adapters/types.ts`

### 4. BackendEventParser — Push/Flush Interface

Adapters that produce structured output provide a parser. The parser receives raw output chunks and returns normalized events:

```typescript
interface BackendEventParser {
  /**
   * Feed a chunk of raw output (typically one line for ndjson).
   * Returns zero or more normalized events extracted from this chunk.
   */
  push(chunk: string): NormalizedBackendEvent[];

  /**
   * Signal end of stream. Returns any buffered/pending events.
   */
  flush(): NormalizedBackendEvent[];
}
```

**Design choice: stateful parser, not pure function.** Parsers need to track state (e.g., tool start timestamps for duration calculation, partial JSON buffers). The push/flush pattern follows Node.js Transform stream conventions.

**Text adapters** return `undefined` from `createParser()`. The executor treats absent parser as "emit `raw_output` for every chunk."

### 5. NormalizedBackendEvent — Backend-Agnostic Event Union

The event model that flows from the parser to the executor's callback. Backend-agnostic — no Claude/Pi/etc field names:

```typescript
type NormalizedBackendEvent =
  | { type: "tool_start"; name: string; argsSummary: string; startedAt: number }
  | { type: "tool_finish"; name: string; argsSummary: string; durationMs: number; isError: boolean }
  | { type: "text_delta"; text: string }
  | { type: "message"; text: string }
  | { type: "turn_end" }
  | { type: "agent_end" }
  | { type: "raw_output"; text: string };
```

| Event | Meaning | Source |
|---|---|---|
| `tool_start` | Backend began executing a tool | Structured adapters only |
| `tool_finish` | Tool execution completed | Structured adapters only |
| `text_delta` | Incremental text output (assistant response) | Structured adapters |
| `message` | Complete message boundary | Structured adapters |
| `turn_end` | Conversational turn completed | Structured adapters |
| `agent_end` | Backend agent session ended | Structured adapters |
| `raw_output` | Raw text chunk from stdout | All adapters (executor-emitted) |

**`raw_output` is always emitted by the executor** for every chunk read from stdout, regardless of parser. This ensures the output buffer is accumulated identically to the current `execSync` path. Parser events are *additional* structure on top of `raw_output`.

**`argsSummary` sanitization:** Truncated to 120 characters, built from the first/primary argument only (e.g., file path for Read/Edit, command for Bash). Never includes file contents or `old_string`/`new_string` values.

### 6. Adapter Registry and Resolution

A static registry keyed by adapter name. No plugin system, no dynamic discovery — this repo has 3 backends:

```typescript
const ADAPTER_REGISTRY: Map<string, () => BackendAdapter> = new Map([
  ["claude", () => new ClaudeAdapter()],
  ["text",   () => new TextAdapter()],
  ["pi",     () => new PiAdapter()],
]);

function resolveBackendAdapter(spec: BackendSpec): BackendAdapter {
  // 1. Explicit kind match
  if (ADAPTER_REGISTRY.has(spec.kind)) {
    return ADAPTER_REGISTRY.get(spec.kind)!();
  }
  // 2. Command-name heuristic (e.g., basename "claude" → claude adapter)
  const base = basename(spec.command);
  if (ADAPTER_REGISTRY.has(base)) {
    return ADAPTER_REGISTRY.get(base)!();
  }
  // 3. Fallback: text adapter
  return new TextAdapter(base || spec.kind);
}
```

**Resolution order:** explicit kind → command basename → text fallback. This replaces the current `normalizeProviderKind()` string checks.

**File:** `src/backend/adapters/index.ts`

### 7. Generic Async Executor — `executeBackend()`

The executor replaces `runShellCommand()` for adapter-based execution. It handles spawn, streaming, timeout, and signal management:

```typescript
async function executeBackend(
  invocation: BackendInvocation,
  adapter: BackendAdapter,
  timeoutMs: number,
  onEvent: (event: NormalizedBackendEvent) => void,
): Promise<BackendRunResult> {
  const parser = adapter.createParser?.();
  const outputChunks: string[] = [];

  const child = spawn(invocation.command, invocation.args, {
    env: { ...process.env, ...invocation.env },
    cwd: invocation.cwd,
    stdio: ["pipe", "pipe", "inherit"],
  });

  if (invocation.stdin) {
    child.stdin.write(invocation.stdin);
    child.stdin.end();
  }

  const rl = createInterface({ input: child.stdout });

  for await (const line of rl) {
    // Always emit raw_output and accumulate
    onEvent({ type: "raw_output", text: line });
    outputChunks.push(line);

    // Structured parsing (if available)
    if (parser) {
      for (const event of parser.push(line)) {
        onEvent(event);
      }
    }
  }

  // Flush any remaining parser state
  if (parser) {
    for (const event of parser.flush()) {
      onEvent(event);
    }
  }

  const exitCode = await waitForExit(child);
  const output = outputChunks.join("\n");
  // ... build and return BackendRunResult
}
```

**Timeout handling:** `setTimeout` + `child.kill("SIGTERM")`, same semantics as current `execSync` timeout. The executor catches the killed-process case and returns `{ timedOut: true }`.

**Signal wrapping:** The current `wrapProcessInvocation()` adds shell-level trap/wait logic. The executor handles this at the Node.js level via `child.on('exit')` and cleanup handlers, eliminating the shell wrapper.

**File:** `src/backend/executor.ts`

### 8. Capability Model

Typed object with known capabilities, extensible via interface augmentation:

```typescript
interface BackendCapabilities {
  /** Whether the adapter supports incremental output streaming. */
  streaming: boolean;

  /** Whether the adapter emits structured tool_start/tool_finish events. */
  structuredToolEvents: boolean;
}
```

**Design decision: typed object over string set.** The repo currently has 2 capabilities. A typed object provides autocomplete and compile-time checking. If future capabilities proliferate beyond ~5, the interface can be converted to `Record<string, boolean>` without breaking consumers (since object access and record access are compatible).

**Harness consumption pattern:**

```typescript
const adapter = resolveBackendAdapter(loop.backend);
if (adapter.capabilities.streaming) {
  result = await executeBackend(invocation, adapter, timeoutMs, onEvent);
} else {
  result = runShellCommand(providerKind, shellCommand, timeoutMs);
}
```

### 9. Initial Adapter Implementations

**Claude Adapter** (`src/backend/adapters/claude.ts`):
- `outputMode: "ndjson"`
- `capabilities: { streaming: true, structuredToolEvents: true }`
- `buildInvocation`: adds `--mode json` flag, sets stdin prompt mode
- `createParser`: returns a `ClaudeEventParser` that maps Claude-specific JSON events (`tool_execution_start`, `tool_execution_end`, `message_update`, etc.) to `NormalizedBackendEvent`
- All Claude-specific field names are contained within this file

**Text Adapter** (`src/backend/adapters/text.ts`):
- `outputMode: "text"`
- `capabilities: { streaming: true, structuredToolEvents: false }`
- `buildInvocation`: delegates to existing `buildCommandInvocation()` logic
- `createParser`: returns `undefined`
- Streaming is enabled (`spawn` replaces `execSync`) but no structured events

**Pi Adapter** (`src/backend/adapters/pi.ts`):
- `outputMode: "text"` (initially; could upgrade to ndjson later if Pi supports it)
- `capabilities: { streaming: true, structuredToolEvents: false }`
- `buildInvocation`: delegates to existing `buildPiAdapterInvocation()` logic
- `createParser`: returns `undefined`

**Mock Adapter** — stays as a detection-only helper (`src/backend/run-mock.ts`). Mock is test infrastructure, not a real backend. Detection feeds into the text adapter with `name: "mock"`.

### 10. Migration Path

The migration is incremental. Each phase is independently shippable:

**Phase 1: Adapter types + registry** (no execution change)
- Define `BackendAdapter`, `BackendInvocation`, `BackendEventParser`, `NormalizedBackendEvent`, `BackendCapabilities`
- Implement `resolveBackendAdapter()` registry
- Implement Claude, Text, Pi adapters with `buildInvocation`
- Register `tool.start` / `tool.finish` as system topics
- Existing execution path (`execSync`) is unchanged

**Phase 2: Async executor** (execution changes)
- Implement `executeBackend()` using `child_process.spawn`
- Make `runIteration()` async → cascades to `iterate()`, `finishIteration()`, `executeParallelWave()`
- Wire adapter resolution into the iteration path
- Text/Pi adapters use spawn (streaming capable, no parser)
- Claude adapter uses spawn + parser

**Phase 3: Harness integration** (event plumbing)
- Wire `onEvent` callback into journal emission (`tool.start` / `tool.finish` topics)
- Accumulate tool calls for `iteration.finish` fields
- Remove old `buildBackendShellCommand()` → `runShellCommand()` path
- Terminal display of streaming events (covered by `realtime-tool-activity` RFC)

**Key constraint:** Phase 1 must not break any existing tests or behavior. Adapters are defined but not yet in the execution path. Phase 2 swaps the execution mechanism. Phase 3 wires up event consumers.

**Rollback:** Each phase can be reverted independently. Phase 1 is pure additive (new files, new exports). Phase 2's async conversion is the largest blast radius — if issues arise, the text adapter can temporarily delegate to `runShellCommand()` via a sync wrapper.

---

## Layering with Dependent RFCs

```
Layer 0: backend-adapters (this RFC)
  ├─ BackendAdapter interface + registry
  ├─ BackendInvocation, BackendEventParser, NormalizedBackendEvent
  ├─ BackendCapabilities model
  ├─ executeBackend() async executor
  └─ Migration from execSync

Layer 1: progressive-activity-disclosure (unchanged, independent)
  ├─ Post-hoc activity capture (git diff, regex)
  ├─ ActivitySummary, iteration.finish fields
  └─ Terminal footer, inspect activity, dashboard sections
      (works with ALL backends — structured or not)

Layer 2: realtime-tool-activity (depends on Layer 0 + Layer 1)
  ├─ Claude as first structured adapter IMPLEMENTATION details
  ├─ Claude-specific parser mapping (claude.ts adapter)
  ├─ Realtime terminal/journal tool activity via onEvent callback
  └─ Source priority: structured events → post-hoc regex → empty
```

**Boundary rules:**
- `backend-adapters` defines *what* events look like and *how* to execute. No Claude-specific logic.
- `progressive-activity-disclosure` defines *post-hoc* activity extraction. Works with or without adapters.
- `realtime-tool-activity` defines *realtime* activity capture using adapter events. Depends on adapter streaming.

---

## Backward Compatibility

- **No breaking changes in Phase 1.** Adapter types are additive. Existing execution path is untouched.
- **Phase 2 makes `runIteration` async.** This is internal to the harness — no public API surface changes. The async conversion is mechanical (add `async`/`await` at each call site).
- **`BackendRunResult` is unchanged.** The executor produces the same result shape. Downstream consumers (journal, completion detection, display) are unaffected.
- **Non-structured backends continue working.** The text adapter wraps the same invocation logic, just via `spawn` instead of `execSync`.
- **`BackendCommandContext` is unchanged.** The `AdapterContext` narrowing is internal — existing code that uses `BackendCommandContext` keeps working.

---

## Open Questions

1. **Stdio buffering with spawn.** The current `execSync` path gets all output at once. With `spawn`, if a backend buffers stdout, lines may not arrive incrementally. Mitigation: `stdbuf -oL` wrapper or PTY allocation if needed. Low risk for Claude (`--mode json` implies line-buffered ndjson).

2. **Shell wrapping.** The current `wrapProcessInvocation()` adds trap/wait shell logic for clean signal handling. The async executor uses Node.js-level signal handling instead. Verify that `child.kill("SIGTERM")` propagates correctly to grandchild processes spawned by the backend command.

3. **Parallel mode interaction.** Async `runIteration` in parallel mode uses worktrees with separate journals, so interleaving is safe. Verify no race conditions in the sequential (non-worktree) parallel path.

---

## File Layout

```
src/backend/
├── adapters/
│   ├── types.ts          # BackendAdapter, BackendInvocation, BackendEventParser,
│   │                     # NormalizedBackendEvent, BackendCapabilities, AdapterContext
│   ├── index.ts          # resolveBackendAdapter(), ADAPTER_REGISTRY
│   ├── claude.ts         # ClaudeAdapter, ClaudeEventParser
│   ├── text.ts           # TextAdapter
│   └── pi.ts             # PiAdapter
├── executor.ts           # executeBackend()
├── run-command.ts         # runShellCommand() (retained for fallback)
├── run-mock.ts            # mockBackend() detection (unchanged)
├── run-pi.ts              # buildPiAdapterInvocation() (retained, called by PiAdapter)
├── types.ts               # BackendSpec, BackendRunResult, BackendCommandContext (unchanged)
└── index.ts               # barrel exports (updated to include adapter exports)
```
