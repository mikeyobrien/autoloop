// Durable waits (T-008): park a named run without a live backend.
//
// An agent emits the reserved `wait.request` topic. The harness journals
// `wait.open`, flips the registry to `waiting`, and returns so the process
// can exit 0. Nothing polls. Nothing holds `backend.timeout_ms`. Resume
// on the same run_id journals `wait.close` and continues.
//
// Duration on the request is advisory metadata for a host/operator — v1
// does not spawn a sleeper. That is the whole point versus `bin/backoff`.

import {
  decodeEvent,
  jsonField,
  parseDurationMs,
} from "@mobrienv/autoloop-core";

export const WAIT_REQUEST_TOPIC = "wait.request";
export const WAIT_OPEN_TOPIC = "wait.open";
export const WAIT_CLOSE_TOPIC = "wait.close";

const PAIR_RE = /([A-Za-z_][\w.-]*)\s*=\s*([^;]*?)\s*;/g;
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export interface WaitRequest {
  /** Operator-facing name; empty when the payload did not supply one. */
  name: string;
  /** Free-text why this run is parking. */
  reason: string;
  /** Raw duration token from the payload (advisory). */
  duration: string;
  /** Parsed duration in ms, or 0 when absent/invalid. */
  durationMs: number;
}

export interface OpenWait {
  waitId: string;
  reason: string;
  name: string;
  duration: string;
  iteration: string;
}

export function isWaitRequestTopic(topic: string): boolean {
  return topic === WAIT_REQUEST_TOPIC;
}

export function isWaitLifecycleTopic(topic: string): boolean {
  return topic === WAIT_OPEN_TOPIC || topic === WAIT_CLOSE_TOPIC;
}

/**
 * Parse a `wait.request` payload. Structured `key=value;` pairs win when
 * present (`name`, `duration`, `reason`); otherwise the whole string is the
 * reason. Unknown keys are ignored.
 */
export function parseWaitRequest(payload: string): WaitRequest {
  const text = payload.trim();
  const pairs = parsePairs(text);
  if (!pairs) {
    return {
      name: "",
      reason: text,
      duration: "",
      durationMs: 0,
    };
  }
  const name = pairs.name?.trim() ?? "";
  const duration = pairs.duration?.trim() ?? "";
  const reason = (pairs.reason?.trim() || leftoverReason(text)).trim();
  return {
    name,
    reason,
    duration,
    durationMs: durationMsOf(duration),
  };
}

export function waitIdFor(
  runId: string,
  iteration: number,
  name: string,
): string {
  const sanitized = sanitizeWaitName(name);
  if (sanitized) return sanitized;
  return `wait_${runId}_${iteration}`;
}

export function sanitizeWaitName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!cleaned || !NAME_RE.test(cleaned)) return "";
  return cleaned;
}

export function waitOpenFields(waitId: string, request: WaitRequest): string {
  const parts = [
    jsonField("wait_id", waitId),
    jsonField("reason", request.reason),
  ];
  if (request.name) parts.push(jsonField("name", request.name));
  if (request.duration) parts.push(jsonField("duration", request.duration));
  if (request.durationMs > 0) {
    parts.push(jsonField("duration_ms", String(request.durationMs)));
  }
  return parts.join(", ");
}

export function waitCloseFields(waitId: string): string {
  return jsonField("wait_id", waitId);
}

/**
 * Latest unmatched `wait.open` for `runId`, or null when every open has a
 * later `wait.close`. Used by resume to close the parked wait on the same
 * run_id.
 */
export function openWaitFromLines(
  lines: string[],
  runId: string,
): OpenWait | null {
  let open: OpenWait | null = null;
  for (const line of lines) {
    const event = decodeEvent(line);
    if (!event || event.run !== runId) continue;
    if (event.topic === WAIT_OPEN_TOPIC && event.shape === "fields") {
      open = {
        waitId: event.fields.wait_id ?? "",
        reason: event.fields.reason ?? "",
        name: event.fields.name ?? "",
        duration: event.fields.duration ?? "",
        iteration: event.iteration ?? "",
      };
    } else if (event.topic === WAIT_CLOSE_TOPIC) {
      open = null;
    }
  }
  return open;
}

function parsePairs(payload: string): Record<string, string> | null {
  const pairs: Record<string, string> = {};
  let saw = false;
  PAIR_RE.lastIndex = 0;
  let match = PAIR_RE.exec(payload);
  while (match) {
    saw = true;
    pairs[match[1]] = match[2].trim();
    match = PAIR_RE.exec(payload);
  }
  return saw ? pairs : null;
}

function leftoverReason(payload: string): string {
  return payload.replace(/([A-Za-z_][\w.-]*)\s*=\s*([^;]*?)\s*;/g, "").trim();
}

function durationMsOf(raw: string): number {
  if (!raw) return 0;
  const parsed = parseDurationMs(raw);
  return parsed !== null && parsed > 0 ? parsed : 0;
}
