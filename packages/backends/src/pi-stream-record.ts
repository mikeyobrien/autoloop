import type { PiRpcMessage } from "./pi-rpc-client.js";

export interface PreparedPiStreamRecord {
  message?: PiRpcMessage;
  persistedLine: string;
}

/**
 * Parse one RPC record and compact only its persisted representation.
 *
 * Pi lifecycle events may include the complete message history accumulated so
 * far. Keeping that history on every message_end and turn_end makes stream
 * logs quadratic. Their current `message` and all other event fields remain;
 * agent_end retains the one terminal snapshot used for final-state replay.
 * Malformed records remain observable in the raw log but are not dispatched.
 */
export function preparePiStreamRecord(line: string): PreparedPiStreamRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { persistedLine: line };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { persistedLine: line };
  }

  const message = parsed as PiRpcMessage;
  if (
    (message.type === "message_end" || message.type === "turn_end") &&
    Array.isArray(message.messages)
  ) {
    const { messages: _historicalMessages, ...compacted } = message;
    return { message, persistedLine: JSON.stringify(compacted) };
  }
  return { message, persistedLine: line };
}
