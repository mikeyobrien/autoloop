# RFC: Loop Guidance Injection

**Status:** Draft
**Slug:** `loop-guidance-injection`
**Date:** 2026-04-06

## Summary

Add a mechanism for operators to inject guidance into running autoloop iterations. An operator sends a text message via a new `guide` CLI subcommand; the message is written to the journal as an `operator.guidance` event, drained at the next iteration boundary, rendered prominently in the prompt, and cleared after one-shot consumption.

## Motivation

All current instruction sources in autoloop-ts are either static (harness.md, role prompts, profiles — set before the run) or automated (memory, metareview). An operator watching a loop drift has no way to steer it without killing and restarting. Ralph-orchestrator solves this with `human.guidance` events drained at iteration boundaries and rendered as `## ROBOT GUIDANCE` in the prompt. This RFC brings the same pattern to autoloop-ts with minimal surface area.

## Design

### 1. New Event Topic: `operator.guidance`

Add `operator.guidance` to the type system alongside existing topics. It is **not** a routing topic — it does not participate in topology validation or state-machine transitions. It is an out-of-band injection channel.

**File:** `src/events/types.ts`

```typescript
export type OperatorTopic = "operator.guidance";
```

Add `OperatorTopic` to the `KnownTopic` union.

### 2. New CLI Subcommand: `guide`

**File:** `src/main.ts` (new case in dispatch switch) + `src/commands/guide.ts` (new file)

```
autoloops guide "Please focus on error handling in the next iteration"
autoloops guide --run <runId> "Steer toward the auth module"
```

Behavior:
1. Resolve the active run's journal file (same logic as `emit`: `AUTOLOOP_PROJECT_DIR` → config → `.autoloop/runs/<runId>/journal.jsonl`)
2. Append a `PayloadEvent` with topic `operator.guidance`, source `"operator"`, and the guidance text as payload
3. Print confirmation: `Guidance queued for next iteration of run <runId>`
4. Exit immediately (fire-and-forget)

**Run resolution:** If `--run` is not specified, use `AUTOLOOP_RUN_ID` env var (set by the harness during iteration), falling back to `latestRunId()` from the journal.

**No routing validation.** Unlike `emit`, the `guide` command does NOT check `AUTOLOOP_ALLOWED_EVENTS`. Guidance is always accepted.

### 3. Guidance Drain and Rendering

**File:** `src/harness/prompt.ts`

#### 3a. Drain function

```typescript
export function drainGuidance(runLines: string[]): string[] {
  // Collect all operator.guidance payloads not yet consumed
  // "Consumed" = any guidance event whose iteration < current iteration
  // Since guidance events don't carry an iteration field when injected externally,
  // track consumption by checking if a guidance event's timestamp is older than
  // the most recent iteration.start event
  return runLines
    .filter(line => extractTopic(line) === "operator.guidance")
    .map(line => extractField(line, "payload"))
    .filter(Boolean);
}
```

Wait — this needs to be one-shot. We need to know which guidance has already been rendered. Two approaches:

**Option A: Marker event.** After rendering guidance, append `operator.guidance.consumed` to the journal. Drain filters out guidance events that precede a consumed marker.

**Option B: Iteration-gated.** Guidance events injected externally have no `iteration` field. At drain time, collect guidance events whose timestamp is after the last `operator.guidance.consumed` marker (or after `loop.start` if no marker exists).

**Chosen: Option A (marker event).** Simpler, auditable, and avoids timestamp comparison edge cases.

Drain logic:
1. Find the timestamp of the last `operator.guidance.consumed` event (or `loop.start` if none)
2. Collect all `operator.guidance` events with timestamps after that marker
3. Return their payloads as `string[]`

#### 3b. Render in prompt

In `renderIterationPromptText()`, insert a new section **between Objective and Memory** (line ~243 in current code):

```typescript
// After: loop.objective + "\n\n"
// Before: (memoryText ? memoryText + "\n" : "")

const guidance = drainGuidance(runLines);
const guidanceText = guidance.length > 0
  ? "## OPERATOR GUIDANCE\n\n" +
    (guidance.length === 1
      ? guidance[0]
      : guidance.map((g, i) => `${i + 1}. ${g}`).join("\n")) +
    "\n\n⚠️ Act on this guidance in this iteration. It will not be repeated.\n\n"
  : "";
```

#### 3c. Consume marker

After prompt is built and guidance was rendered, append `operator.guidance.consumed` to the journal. This happens in `buildIterationContext()` after `renderIterationPromptText()` returns.

```typescript
if (guidance.length > 0) {
  appendHarnessEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "operator.guidance.consumed",
    `Consumed ${guidance.length} guidance message(s)`,
  );
}
```

### 4. Scratchpad Persistence

The scratchpad already captures the full prompt context per iteration. Guidance will naturally appear in scratchpad entries because it's part of the rendered prompt. No additional scratchpad logic is needed — if the agent's output references the guidance, it will be visible in the scratchpad for later iterations.

### 5. Metareview Visibility

Metareview iterations use `renderReviewPromptText()`, which should also drain and render guidance. Apply the same drain logic there so operators can steer metareview passes too.

### 6. Wire Through `DerivedRunContext`

To make `runLines` available at guidance drain time without re-reading the journal:

1. Add `guidanceMessages: string[]` to the `DerivedRunContext` interface
2. Populate it in `deriveRunContext()` by calling `drainGuidance(runLines)`
3. Reference `derived.guidanceMessages` in `renderIterationPromptText()`
4. Emit the consumed marker in `buildIterationContext()` after prompt render

## Data Flow

```
Operator                    Journal                     Iteration Loop
   |                           |                             |
   |-- guide "fix auth" ------>|                             |
   |                           | operator.guidance event     |
   |                           |                             |
   |                           |<--- buildIterationContext --|
   |                           |     drainGuidance()         |
   |                           |                             |
   |                           |     renderIterationPrompt   |
   |                           |     ## OPERATOR GUIDANCE    |
   |                           |     "fix auth"              |
   |                           |                             |
   |                           |<--- consumed marker --------|
   |                           | operator.guidance.consumed  |
   |                           |                             |
   |                           |     (next iteration: no     |
   |                           |      guidance rendered)     |
```

## File Changes Summary

| File | Change |
|---|---|
| `src/events/types.ts` | Add `OperatorTopic` to type union |
| `src/commands/guide.ts` | New file: `dispatchGuide()` — resolve journal, append guidance event |
| `src/main.ts` | Add `guide` case to dispatch switch |
| `src/harness/prompt.ts` | Add `drainGuidance()`, render guidance section in `renderIterationPromptText()` and `renderReviewPromptText()`, emit consumed marker in `buildIterationContext()` |
| `src/harness/journal.ts` | (No changes — existing `appendHarnessEvent` / `readRunLines` / `extractTopic` are sufficient) |

## Edge Cases

1. **Multiple guidance messages before next iteration:** All are drained and rendered as a numbered list (matches ralph's behavior).
2. **Guidance injected during metareview:** Visible in the metareview prompt via the same drain path.
3. **No active run:** `guide` command prints an error and exits non-zero if no run can be resolved.
4. **Guidance after loop completes:** Silently accepted into journal but never rendered (no more iterations to drain it). The `guide` command could warn if the run is already complete, but this is optional for v1.
5. **Race condition (guidance written while iteration is building prompt):** Journal append is atomic (single `appendFileSync` call). If guidance arrives after `drainGuidance()` but before the iteration ends, it will be picked up by the next iteration. No data loss.
6. **Crash recovery:** Guidance events persist in the journal. If the loop restarts with the same run ID, unconsumed guidance (no consumed marker) will be drained in the first post-recovery iteration.

## Future Work (Out of Scope)

- **Urgent/mid-iteration steering:** Would require a gate file or signal mechanism (ralph's `.ralph/urgent-steer.json` pattern)
- **Role-targeted guidance:** Add optional `target_role` field to guidance events; only render when the active role matches
- **External channels:** Telegram, Slack, Discord integration via adapters that write `operator.guidance` events
- **Structured metadata:** Priority levels, expiry timestamps, categories
- **Blocking interactions:** `operator.interact` pattern (ralph's `human.interact`) for human-in-the-loop confirmations
