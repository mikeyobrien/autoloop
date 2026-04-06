# Sub-task 3: Harness Integration — Session Lifecycle and Iteration Dispatch

**Parent task:** `kiro-acp-backend.code-task.md`
**Modified files:** `src/harness/index.ts`, `src/harness/iteration.ts`, `src/harness/types.ts`
**Depends on:** Sub-task 1 (acp-client.ts), Sub-task 2 (run-kiro.ts)
**Estimated scope:** ~100 lines modified

## Objective

Wire the ACP session lifecycle into the harness run loop so that `kind: "kiro"` runs spawn a persistent session before the first iteration, dispatch prompts through ACP instead of shell commands, and clean up the session on exit.

## Steps

### 1. Extend `LoopContext` in `src/harness/types.ts`

Add an optional session holder to the runtime context:

```typescript
// In LoopContext or as a module-level state
kiroSession?: import("../backend/acp-client.js").AcpSession;
```

This is set after `initKiroSession()` and read by `runIteration()`. It's `undefined` for non-kiro backends.

### 2. Update run lifecycle in `src/harness/index.ts`

In the main `run()` function, after `buildLoopContext()`:

```typescript
if (loop.backend.kind === "kiro") {
  loop.kiroSession = await initKiroSession({
    command: loop.backend.command,
    args: loop.backend.args,
    cwd: loop.paths.projectDir,
    trustAllTools: configGet(config, "backend.trust_all_tools", "true") !== "false",
    agentName: configGet(config, "backend.agent", ""),
    modelId: configGet(config, "backend.model", ""),
  });
}
```

After the loop ends (in the finally/cleanup path):

```typescript
if (loop.kiroSession) {
  await terminateSession(loop.kiroSession);
}
```

Register signal handlers (SIGINT, SIGTERM) that also terminate the session.

### 3. Update iteration dispatch in `src/harness/iteration.ts`

In `runIteration()`, before the existing `runProcess()` call, add a branch:

```typescript
if (loop.backend.kind === "kiro" && loop.kiroSession) {
  const result = await runKiroIteration(
    loop.kiroSession,
    iter.prompt,
    loop.backend.timeoutMs,
  );
  // result is already a BackendRunResult — continue with the same
  // journal append, event extraction, and completion check flow
  const { output, exitCode, timedOut } = result;
  // ... rest of iteration handling identical to existing path
}
```

The key constraint: `runKiroIteration` must return a `BackendRunResult` so the downstream flow (journal append, event extraction, completion detection) is completely unchanged.

### 4. Handle the sync/async boundary

The existing harness is synchronous (`execSync` in `runShellCommand`). The kiro backend is inherently async (ACP is a streaming protocol). Options:

- **Option A (recommended)**: Make `runIteration` async for kiro, keep sync for pi/command. The harness `iterate()` loop already controls flow — making it async is a localized change.
- **Option B**: Use a sync wrapper that blocks on the async ACP call (e.g. `execSync` calling a helper script). Less clean but zero harness changes.

Go with Option A. The `iterate()` function and its callers need `async/await` added. The pi/command path stays synchronous within the async wrapper.

### 5. Review pass support

In the metareview path (`src/harness/metareview.ts` or equivalent), apply the same dispatch: if `review.kind === "kiro"`, send the review prompt through the same ACP session. The agent's conversation history provides natural continuity — no separate session needed.

### Acceptance Criteria

- `autoloops run autocode -b kiro "task"` spawns `kiro-cli acp` once, creates a session, and reuses it across all iterations
- Each iteration sends the projected prompt via `session/prompt` and collects the text response
- Journal entries (`iteration.start`, `backend.start`, `backend.finish`, `iteration.finish`) are written identically to other backends
- Event extraction from the output works — `autoloops emit` calls in the agent's tool output are detected
- The kiro process is terminated on loop completion, failure, SIGINT, or SIGTERM
- Review iterations go through the same ACP session
- The pi and command backends are completely unchanged — no regressions

## Metadata

- **Complexity**: Medium
- **Parent Task**: `kiro-acp-backend.code-task.md`
- **Depends On**: Sub-task 1, Sub-task 2
