import type { LiveControlAdapter } from "./adapter.js";
import { defaultCapabilities } from "./capabilities.js";
import type {
  ControlAck,
  ControlCapabilities,
  ControlRequest,
  GuidePayload,
} from "./types.js";

/**
 * Live-control adapter for the Pi backend. Pi has no in-flight cancel; we keep
 * it in the abstraction by reporting limited capabilities honestly. Guidance
 * is still durable via the journal, so `guide` is always applied even when
 * its interrupt component is ignored.
 */
export function piControlAdapter(runId: string): LiveControlAdapter {
  const caps = buildCapabilities(runId);

  return {
    backend: "pi",
    capabilities(): ControlCapabilities {
      return caps;
    },
    onRequest(request: ControlRequest): ControlAck {
      if (request.verb === "interrupt") {
        return {
          state: "ignored",
          detail: "pi backend has no in-flight cancel",
        };
      }
      if (request.verb === "guide") {
        const payload = request.payload as GuidePayload;
        if (payload?.interrupt) {
          return {
            state: "applied",
            detail: "guidance appended; interrupt ignored (pi)",
          };
        }
        return { state: "applied", detail: "guidance appended" };
      }
      return { state: "ignored", detail: `unknown verb: ${request.verb}` };
    },
  };
}

function buildCapabilities(runId: string): ControlCapabilities {
  return defaultCapabilities("pi", runId);
}
