import type { LiveControlAdapter } from "./adapter.js";
import { defaultCapabilities } from "./capabilities.js";
import type {
  ControlAck,
  ControlCapabilities,
  ControlRequest,
  GuidePayload,
} from "./types.js";

export interface ClaudeSdkAdapterHooks {
  /** Called when the supervisor asks the backend to cancel its in-flight turn. */
  triggerInterrupt: () => void;
  /** Called to queue guidance into the in-flight turn as a steering user message. */
  triggerSteer: (message: string) => void;
}

/**
 * Live-control adapter for the claude-sdk backend. The Claude Agent SDK runs
 * each iteration as a streaming-input session: `interrupt()` cancels the
 * in-flight turn, and a pushed user message steers it mid-turn — delivered at
 * the next safe boundary. Guidance also stays durable via the journal, so
 * `guide` is always applied even when live steering is unavailable.
 */
export function claudeSdkControlAdapter(
  runId: string,
  hooks: ClaudeSdkAdapterHooks,
): LiveControlAdapter {
  const caps = buildCapabilities(runId);

  return {
    backend: "claude-sdk",
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
        return applySteer(hooks, payload?.message ?? "");
      }
      return { state: "ignored", detail: `unknown verb: ${request.verb}` };
    },
  };
}

function buildCapabilities(runId: string): ControlCapabilities {
  const base = defaultCapabilities("claude-sdk", runId);
  base.interrupt = {
    supported: true,
    detail: "SDK interrupt() of the in-flight turn",
  };
  base.guidance = {
    supported: true,
    detail: "journal-durable + live steer into the in-flight turn",
  };
  return base;
}

function applySteer(hooks: ClaudeSdkAdapterHooks, message: string): ControlAck {
  if (!message) {
    return { state: "applied", detail: "guidance appended" };
  }
  try {
    hooks.triggerSteer(message);
    return {
      state: "applied",
      detail: "guidance appended + steered into live turn",
    };
  } catch {
    // Steering is opportunistic; the journal copy still reaches the next
    // iteration prompt, so the guidance itself is applied either way.
    return {
      state: "applied",
      detail: "guidance appended (live steer unavailable)",
    };
  }
}

function applyInterrupt(
  hooks: ClaudeSdkAdapterHooks,
  detailPrefix = "interrupt",
): ControlAck {
  try {
    hooks.triggerInterrupt();
    return {
      state: "applied",
      detail: `${detailPrefix}: SDK interrupt sent`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      state: "rejected",
      detail: `${detailPrefix}: interrupt failed: ${msg}`,
    };
  }
}
