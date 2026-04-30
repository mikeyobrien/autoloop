import type { LiveControlAdapter } from "./adapter.js";
import { defaultCapabilities } from "./capabilities.js";
import type {
  ControlAck,
  ControlCapabilities,
  ControlRequest,
  GuidePayload,
} from "./types.js";

export interface KiroAdapterHooks {
  /** Called when the supervisor asks the backend to cancel its in-flight turn. */
  triggerInterrupt: () => void;
}

/**
 * Live-control adapter for the Kiro ACP backend. Kiro has a real cancel: the
 * ACP connection supports `cancel`, and the bridge's `signalInterrupt` kills
 * the detached child process group as a fallback. Both are reachable via the
 * provided `triggerInterrupt` hook.
 */
export function kiroControlAdapter(
  runId: string,
  hooks: KiroAdapterHooks,
): LiveControlAdapter {
  const caps = buildCapabilities(runId);

  return {
    backend: "kiro",
    capabilities(): ControlCapabilities {
      return caps;
    },
    onRequest(request: ControlRequest): ControlAck {
      if (request.verb === "interrupt") {
        return applyInterrupt(hooks);
      }
      if (request.verb === "guide") {
        const payload = request.payload as GuidePayload;
        if (payload?.interrupt) {
          return applyInterrupt(hooks, "guidance-driven");
        }
        return { state: "applied", detail: "guidance appended" };
      }
      return { state: "ignored", detail: `unknown verb: ${request.verb}` };
    },
  };
}

function buildCapabilities(runId: string): ControlCapabilities {
  const base = defaultCapabilities("kiro", runId);
  base.interrupt = {
    supported: true,
    detail: "ACP cancel + child-process-group SIGTERM",
  };
  return base;
}

function applyInterrupt(
  hooks: KiroAdapterHooks,
  detailPrefix = "interrupt",
): ControlAck {
  try {
    hooks.triggerInterrupt();
    return { state: "applied", detail: `${detailPrefix}: signalled kiro` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      state: "rejected",
      detail: `${detailPrefix}: signal failed: ${msg}`,
    };
  }
}
