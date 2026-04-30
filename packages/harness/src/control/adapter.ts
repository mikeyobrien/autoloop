import type {
  ControlAck,
  ControlCapabilities,
  ControlRequest,
} from "./types.js";

/**
 * Backend-neutral contract for live supervisor control. An adapter is installed
 * by the harness when a run begins. The harness writes capabilities to the
 * run's control dir at publish time and calls `onRequest` each time it drains
 * the control queue.
 */
export interface LiveControlAdapter {
  readonly backend: string;
  capabilities(): ControlCapabilities;
  onRequest(request: ControlRequest): ControlAck;
}
