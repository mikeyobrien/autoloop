/**
 * Synchronous bridge to the kiro ACP worker thread.
 * Uses SharedArrayBuffer + Atomics to block the main thread
 * while the worker processes async ACP operations.
 */
import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AcpClientOptions } from "./acp-client.js";
import type { BackendRunResult } from "./types.js";

const DATA_BUFFER_SIZE = 4 * 1024 * 1024; // 4 MB for prompt/response data

export interface KiroSessionHandle {
  worker: Worker;
  controlBuffer: SharedArrayBuffer;
  dataBuffer: SharedArrayBuffer;
}

function sendCommand(handle: KiroSessionHandle, cmd: unknown): any {
  const control = new Int32Array(handle.controlBuffer);
  const data = new Uint8Array(handle.dataBuffer);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Write command
  const json = encoder.encode(JSON.stringify(cmd));
  new DataView(handle.dataBuffer).setUint32(0, json.length);
  data.set(json, 4);

  // Signal worker
  Atomics.store(control, 0, 1);
  Atomics.notify(control, 0);

  // Block until worker signals result (control[0] = 2)
  Atomics.wait(control, 0, 1);

  // Read result
  const len = new DataView(handle.dataBuffer).getUint32(0);
  const resultJson = decoder.decode(data.slice(4, 4 + len));
  Atomics.store(control, 0, 0); // reset for next command
  Atomics.notify(control, 0);  // wake worker waiting on Atomics.wait(control, 0, 2)
  return JSON.parse(resultJson);
}

export function initKiroSession(opts: AcpClientOptions): KiroSessionHandle {
  const controlBuffer = new SharedArrayBuffer(4);
  const dataBuffer = new SharedArrayBuffer(DATA_BUFFER_SIZE);
  const control = new Int32Array(controlBuffer);
  Atomics.store(control, 0, 0);

  const workerPath = join(fileURLToPath(import.meta.url), "..", "kiro-worker.js");
  const worker = new Worker(workerPath, {
    workerData: { controlBuffer, dataBuffer },
  });

  const handle: KiroSessionHandle = { worker, controlBuffer, dataBuffer };
  const result = sendCommand(handle, { type: "init", opts });
  if (!result.ok) throw new Error("Failed to init kiro session: " + result.error);
  return handle;
}

export function runKiroIterationSync(
  handle: KiroSessionHandle,
  prompt: string,
  timeoutMs: number,
): BackendRunResult {
  const result = sendCommand(handle, { type: "prompt", prompt, timeoutMs });
  if (!result.ok) {
    return {
      output: result.error || "",
      exitCode: 1,
      timedOut: false,
      providerKind: "kiro",
      errorCategory: "non_zero_exit",
    };
  }
  return {
    output: result.output || "",
    exitCode: result.error ? 1 : 0,
    timedOut: result.timedOut || false,
    providerKind: "kiro",
    errorCategory: result.timedOut ? "timeout" : result.error ? "non_zero_exit" : "none",
  };
}

export function setKiroSessionMode(handle: KiroSessionHandle, agentName: string): void {
  const result = sendCommand(handle, { type: "set_mode", agentName });
  if (!result.ok) {
    // Non-fatal: log but don't crash the loop
    process.stderr.write(`[autoloop] warning: failed to set kiro agent mode "${agentName}": ${result.error}\n`);
  }
}

export function terminateKiroSession(handle: KiroSessionHandle): void {
  sendCommand(handle, { type: "terminate" });
  // Signal shutdown
  const control = new Int32Array(handle.controlBuffer);
  Atomics.store(control, 0, 3);
  Atomics.notify(control, 0);
  handle.worker.terminate();
}
