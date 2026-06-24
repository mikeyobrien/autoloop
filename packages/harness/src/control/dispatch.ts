import type { LiveControlAdapter } from "./adapter.js";
import { appendStatus, pendingRequests, writeCapabilities } from "./queue.js";
import type { ControlAck, ControlRequest, ControlStatus } from "./types.js";

/**
 * Publish an adapter's capabilities to the run-scoped control directory.
 * Called at loop start and any time the adapter's capabilities change.
 */
export function publishCapabilities(
  runStateDir: string,
  adapter: LiveControlAdapter,
): void {
  writeCapabilities(runStateDir, adapter.capabilities());
}

/**
 * Drain all pending control requests for this run, handing each to the
 * adapter and recording its ack to the status log.
 *
 * Returns the list of requests that were acknowledged on this drain pass.
 */
export function drainControlRequests(
  runStateDir: string,
  adapter: LiveControlAdapter,
): ControlRequest[] {
  const requests = pendingRequests(runStateDir);
  for (const request of requests) {
    if (request.verb === "respond") {
      // `respond` is consumed by the human-ask poll (awaitHumanResponse), not
      // the live-control adapter. Ack it here as defense so a stray response
      // (with no matching ask) never reaches the adapter and never lingers.
      appendStatus(runStateDir, {
        id: request.id,
        runId: request.runId,
        verb: request.verb,
        state: "ignored",
        at: new Date().toISOString(),
        detail: "respond is handled by the human-ask poll",
      });
      continue;
    }
    ackRequest(runStateDir, adapter, request);
  }
  return requests;
}

function ackRequest(
  runStateDir: string,
  adapter: LiveControlAdapter,
  request: ControlRequest,
): void {
  let ack: ControlAck;
  try {
    ack = adapter.onRequest(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ack = { state: "rejected", detail: `adapter threw: ${msg}` };
  }
  const status: ControlStatus = {
    id: request.id,
    runId: request.runId,
    verb: request.verb,
    state: ack.state,
    at: new Date().toISOString(),
    detail: ack.detail,
  };
  appendStatus(runStateDir, status);
}
