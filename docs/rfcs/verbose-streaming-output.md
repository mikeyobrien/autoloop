# RFC: Verbose Streaming Output for kiro-acp Backend

**Slug:** `verbose-streaming-output`
**Status:** Draft
**Date:** 2026-04-07

## Problem

When running `autoloop run autocode -b kiro <task> -v`, the `-v` flag only enables internal debug log lines (`[autoloops] [debug] ...`). The operator has no visibility into what the kiro agent is doing during an iteration — they see nothing until the iteration completes and `printBackendOutputTail()` dumps the buffered output.

The ACP session already receives real-time streaming events (`agent_message_chunk`, `tool_call`, etc.) via the `sessionUpdate` callback in `acp-client.ts`, but these are silently buffered into `session.textBuffer`.

## Design

### Approach: Direct stderr writes from worker thread

The kiro-acp worker thread (which runs the ACP session) will write formatted streaming output directly to `process.stderr` when verbose mode is enabled. This works because:

1. Node.js worker threads share the parent's stderr file descriptor
2. The main thread is blocked on `Atomics.wait` during iterations and cannot process messages — stderr writes bypass this entirely
3. No changes to the SharedArrayBuffer protocol are needed

### Data flow

```
CLI (-v flag)
  → parseRunArgs() sets logLevel: "debug"
  → buildLoopContext() stores in loop.runtime.logLevel
  → harness/index.ts derives verbose = (logLevel === "debug")
  → AcpClientOptions.verbose = true
  → initKiroSession() passes verbose via workerData
  → kiro-worker.ts passes verbose to initAcpSession()
  → sessionUpdate callback checks verbose flag
  → process.stderr.write(formatted line)
```

### File changes

#### 1. `src/backend/acp-client.ts`

Add `verbose?: boolean` to `AcpClientOptions`. In `initAcpSession()`, expand the `sessionUpdate` callback to handle four event types when verbose is true:

```
sessionUpdate(params) {
  const { update } = params;
  if (!update) return;

  // Always buffer text for the final output
  if (update.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
    session.textBuffer += update.content.text;
  }

  // Stream to stderr when verbose
  if (opts.verbose) {
    formatAndWriteUpdate(update);
  }
}
```

Add a `formatAndWriteUpdate(update)` function that handles:

| `sessionUpdate` | Format | Example |
|---|---|---|
| `agent_message_chunk` | Raw text (no prefix) | `Here is the implementation...` |
| `agent_thought_chunk` | `[thinking] {text}` | `[thinking] I need to check the types...` |
| `tool_call` | `[tool:{kind}] {title}` | `[tool:read] Reading src/main.ts` |
| `tool_call_update` | `[tool:✓] {title}` or `[tool:✗] {title}` | `[tool:✓] Reading src/main.ts` |

Only emit `tool_call_update` lines for terminal statuses (`completed`, `failed`) to avoid noise from `pending`/`in_progress` updates.

For `agent_message_chunk`, write the raw text chunk without a newline (the chunks are partial — newlines come naturally in the text). For all other types, write a full line with `\n`.

#### 2. `src/backend/kiro-bridge.ts`

Pass `verbose` through `workerData`:

```ts
const worker = new Worker(workerPath, {
  workerData: { controlBuffer, dataBuffer, verbose: opts.verbose ?? false },
});
```

Update `initKiroSession` signature to accept the full `AcpClientOptions` (it already does — just ensure `verbose` is included).

#### 3. `src/backend/kiro-worker.ts`

Extract `verbose` from `workerData` and pass it to `initAcpSession`:

```ts
const { controlBuffer, dataBuffer, verbose } = workerData as {
  controlBuffer: SharedArrayBuffer;
  dataBuffer: SharedArrayBuffer;
  verbose: boolean;
};
```

In the `init` command handler, merge verbose into opts:

```ts
case "init": {
  session = await initAcpSession({ ...cmd.opts, verbose });
  return { ok: true, sessionId: session.sessionId };
}
```

#### 4. `src/harness/index.ts`

Derive verbose from logLevel when building AcpClientOptions:

```ts
const acpOpts: AcpClientOptions = {
  // ...existing fields...
  verbose: loop.runtime.logLevel === "debug",
};
```

### What the operator sees

Without `-v` (unchanged):
```
━━━ iteration 1/30 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
role: clarifier │ event: loop.start │ next: brief.ready
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    (silence for 30-120 seconds)
──── end iteration 1 (45s) ─────────────────────────────────────────
── backend stdout (last 50 of 50 lines) ──
...
```

With `-v`:
```
━━━ iteration 1/30 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
role: clarifier │ event: loop.start │ next: brief.ready
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[thinking] I need to understand the codebase structure first...
[tool:read] Reading src/main.ts
[tool:✓] Reading src/main.ts
Let me analyze the main entry point. The application uses...
[tool:read] Reading src/config.ts
[tool:✓] Reading src/config.ts
Based on my analysis, here is the brief:
...
──── end iteration 1 (45s) ─────────────────────────────────────────
```

### Testing strategy

Add tests in `test/backend/`:

1. **`verbose-streaming.test.ts`** — Unit test `formatAndWriteUpdate()` with each event type
2. **Update `test/backend/run-command.test.ts`** or add to existing backend tests — verify verbose flag propagation through `AcpClientOptions`

The `formatAndWriteUpdate` function should be a pure formatter (returns string) with a thin wrapper that writes to stderr, making it easy to test without mocking stderr.

## Rejected Alternatives

- **Secondary SharedArrayBuffer**: Unnecessary complexity when stderr writes work directly
- **parentPort.postMessage**: Main thread can't receive messages while blocked on Atomics.wait
- **File-based streaming**: Would need a third thread for tailing — overkill
