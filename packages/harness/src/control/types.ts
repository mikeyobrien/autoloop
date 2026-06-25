/**
 * Backend-neutral live-control types.
 *
 * The supervisor-facing contract. Adapters (Kiro ACP, Pi, future Claude live
 * sessions) map these verbs to backend-specific behavior; the journal remains
 * canonical for what actually happened.
 */

export type ControlVerb = "interrupt" | "guide" | "respond";
export type CapabilityVerb = "guidance" | "interrupt" | "inspect";

export interface GuidePayload {
  message: string;
  /** If true, operator wants the current turn aborted so guidance is picked up now. */
  interrupt: boolean;
}

export type InterruptPayload = Record<string, never>;

/**
 * Answer to a blocking `human.ask`. An external supervisor (e.g. ralph relaying
 * a Telegram reply) writes this to deliver the human's response to the run that
 * is paused waiting on `questionId`.
 */
export interface RespondPayload {
  questionId: string;
  answer: string;
}

export type ControlPayload = GuidePayload | InterruptPayload | RespondPayload;

export interface ControlRequest {
  id: string;
  runId: string;
  requestedAt: string;
  verb: ControlVerb;
  reason: string;
  payload: ControlPayload;
}

export interface ControlCapability {
  supported: boolean;
  detail?: string;
}

export type ControlCapabilities = Record<CapabilityVerb, ControlCapability> & {
  backend: string;
  publishedAt: string;
  runId: string;
  extras?: Record<string, ControlCapability>;
};

export type ControlStatusState =
  | "received"
  | "applied"
  | "rejected"
  | "ignored";

export interface ControlStatus {
  id: string;
  runId: string;
  verb: ControlVerb;
  state: ControlStatusState;
  at: string;
  detail?: string;
}

export interface ControlAck {
  state: ControlStatusState;
  detail?: string;
}
