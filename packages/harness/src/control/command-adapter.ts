import type { LiveControlAdapter } from "./adapter.js";
import { defaultCapabilities } from "./capabilities.js";
import type {
  ControlAck,
  ControlCapabilities,
  ControlRequest,
  GuidePayload,
} from "./types.js";

export interface CommandAdapterHooks {
  /**
   * Signal the in-flight `command` child: SIGUSR1 first (cooperating tools
   * can trap it and cancel gracefully), escalating internally to SIGTERM then
   * SIGKILL if the process doesn't exit. No-op if no `command` iteration is
   * currently in flight.
   */
  triggerInterrupt: () => void;
}

/**
 * Live-control adapter for the `command` backend (arbitrary wrapped CLI
 * tools). Unlike pi/claude-sdk, `command` iterations are one-shot processes
 * rather than persistent sessions, so there is no mid-turn steering: `guide`
 * is always journal-durable only (applied at the *next* iteration's prompt,
 * same as every other backend via `drainGuidance`), optionally paired with an
 * interrupt of the current iteration when the operator asks for it.
 */
export function commandControlAdapter(
  runId: string,
  hooks: CommandAdapterHooks,
): LiveControlAdapter {
  const caps = buildCapabilities(runId);

  return {
    backend: "command",
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
  const base = defaultCapabilities("command", runId);
  base.interrupt = {
    supported: true,
    detail: "SIGUSR1 to child, escalating to SIGTERM/SIGKILL",
  };
  base.guidance = {
    supported: true,
    detail:
      "journal-durable, applied at next iteration (no live steering for one-shot command processes)",
  };
  return base;
}

function applyInterrupt(
  hooks: CommandAdapterHooks,
  detailPrefix = "interrupt",
): ControlAck {
  try {
    hooks.triggerInterrupt();
    return { state: "applied", detail: `${detailPrefix}: signal sent` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      state: "rejected",
      detail: `${detailPrefix}: signal failed: ${msg}`,
    };
  }
}
