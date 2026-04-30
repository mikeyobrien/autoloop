/**
 * Shared SharedArrayBuffer + Atomics protocol used by kiro-bridge (main
 * thread) and kiro-worker (worker thread) to exchange JSON commands /
 * results synchronously.
 *
 * Layout:
 *   dataBuffer: [ uint32 length | utf-8 JSON bytes ... ]
 *   controlBuffer[0] states:
 *     0 = idle
 *     1 = main wrote a command, worker should read
 *     2 = worker wrote a result, main should read
 *     3 = shutdown requested
 */

export const DATA_BUFFER_SIZE = 4 * 1024 * 1024; // 4 MiB prompt/response payload
export const POLL_INTERVAL_MS = 500;

export const STATE_IDLE = 0;
export const STATE_CMD_PENDING = 1;
export const STATE_RESULT_READY = 2;
export const STATE_SHUTDOWN = 3;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function writeMessage(
  dataBuffer: SharedArrayBuffer,
  msg: unknown,
): void {
  const data = new Uint8Array(dataBuffer);
  const json = encoder.encode(JSON.stringify(msg));
  new DataView(dataBuffer).setUint32(0, json.length);
  data.set(json, 4);
}

export function readMessage(dataBuffer: SharedArrayBuffer): unknown {
  const data = new Uint8Array(dataBuffer);
  const len = new DataView(dataBuffer).getUint32(0);
  const json = decoder.decode(data.slice(4, 4 + len));
  return JSON.parse(json);
}
