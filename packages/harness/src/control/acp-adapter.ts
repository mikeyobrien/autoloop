import type { LiveControlAdapter } from "./adapter.js";
import { defaultCapabilities } from "./capabilities.js";
import type {
  ControlAck,
  ControlCapabilities,
  ControlRequest,
  GuidePayload,
} from "./types.js";

export interface AcpAdapterHooks {
  /** Called when the supervisor asks the backend to cancel its in-flight turn. */
  triggerInterrupt: () => void;
}

/**
 * Live-control adapter for ACP backends. ACP clients expose a cancellable
 * in-flight turn, and the harness also kills the detached child process group as
 * a fallback via the provided `triggerInterrupt` hook.
 */
export function acpControlAdapter(
  runId: string,
  provider: string,
  hooks: AcpAdapterHooks,
): LiveControlAdapter {
  const providerLabel = provider || "generic";
  const caps = buildCapabilities(runId, providerLabel);

  return {
    backend: `acp:${providerLabel}`,
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

export function kiroControlAdapter(
  runId: string,
  hooks: AcpAdapterHooks,
): LiveControlAdapter {
  return acpControlAdapter(runId, "kiro", hooks);
}

function buildCapabilities(
  runId: string,
  provider: string,
): ControlCapabilities {
  const base = defaultCapabilities(`acp:${provider}`, runId);
  base.interrupt = {
    supported: true,
    detail: "ACP cancel + child-process-group SIGTERM",
  };
  return base;
}

function applyInterrupt(
  hooks: AcpAdapterHooks,
  detailPrefix = "interrupt",
): ControlAck {
  try {
    hooks.triggerInterrupt();
    return { state: "applied", detail: `${detailPrefix}: signalled ACP` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      state: "rejected",
      detail: `${detailPrefix}: signal failed: ${msg}`,
    };
  }
}
