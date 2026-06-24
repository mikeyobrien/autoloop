// Blocking human-in-the-loop: pause the loop until an operator responds.
//
// autoloop is turn-based, so HITL maps cleanly to *between-iteration* blocking:
// an agent emits the reserved ask event, the harness journals `ask.pending` and
// blocks here until a matching `respond` control request arrives (the same
// channel `autoloop control respond` writes to) or the timeout elapses, then
// injects the answer into the next prompt as guidance. This lets an external
// supervisor (e.g. ralph relaying a Telegram reply) drive HITL over the
// subprocess engine without a mid-turn hook.

import { appendStatus, readRequests } from "./control/queue.js";
import type { RespondPayload } from "./control/types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AwaitResponseOptions {
  /** Run state dir (loop.paths.stateDir) — control requests live under it. */
  stateDir: string;
  runId: string;
  questionId: string;
  timeoutMs: number;
  pollMs?: number;
  signal?: AbortSignal;
}

/**
 * Block until a `respond` control request matching `questionId` appears, the
 * timeout elapses, or the run is aborted. Returns the answer string, or `null`
 * on timeout/abort. `questionId` is unique per ask, so any pre-existing respond
 * requests for other questions are naturally ignored.
 */
export async function awaitHumanResponse(
  opts: AwaitResponseOptions,
): Promise<string | null> {
  const pollMs = opts.pollMs && opts.pollMs > 0 ? opts.pollMs : 500;
  const deadline = Date.now() + Math.max(0, opts.timeoutMs);

  for (;;) {
    if (opts.signal?.aborted) return null;

    const match = readRequests(opts.stateDir).find(
      (r) =>
        r.verb === "respond" &&
        r.runId === opts.runId &&
        (r.payload as RespondPayload).questionId === opts.questionId,
    );
    if (match) {
      // Ack so the consumed response does not linger as a pending request.
      appendStatus(opts.stateDir, {
        id: match.id,
        runId: match.runId,
        verb: "respond",
        state: "applied",
        at: new Date().toISOString(),
        detail: "delivered to human-ask",
      });
      return (match.payload as RespondPayload).answer;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    await sleep(Math.min(pollMs, remaining));
  }
}
