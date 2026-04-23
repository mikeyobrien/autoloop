import type { JournalEvent } from "./types.js";

const SYSTEM_TOPICS = new Set([
  "iteration.start",
  "iteration.finish",
  "loop.start",
  "loop.complete",
  "loop.stop",
  "review.start",
  "review.finish",
  "backend.start",
  "backend.finish",
  "event.invalid",
]);

const COORDINATION_TOPICS = new Set([
  "issue.discovered",
  "issue.resolved",
  "slice.started",
  "slice.verified",
  "slice.committed",
  "context.archived",
  "chain.spawn",
]);

export function isPayloadEvent(event: JournalEvent | null): boolean {
  return !!event && event.shape === "payload";
}

export function isSystemEvent(event: JournalEvent | null): boolean {
  if (!event) return false;
  if (SYSTEM_TOPICS.has(String(event.topic))) return true;
  return String(event.topic).startsWith("wave.");
}

export function isCoordinationEvent(event: JournalEvent | null): boolean {
  return !!event && COORDINATION_TOPICS.has(String(event.topic));
}

export function isRoutingEvent(event: JournalEvent | null): boolean {
  if (!event) return false;
  if (isCoordinationEvent(event) || isSystemEvent(event)) return false;
  return String(event.topic) !== "";
}
