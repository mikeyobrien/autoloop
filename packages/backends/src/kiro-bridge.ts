/**
 * Synchronous bridge to the kiro ACP worker thread.
 * Uses SharedArrayBuffer + Atomics to block the main thread while the worker
 * processes async ACP operations.
 *
 * Protocol + state constants live in kiro-ipc.ts.
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { AcpClientOptions } from "./acp-client.js";
import {
  DATA_BUFFER_SIZE,
  POLL_INTERVAL_MS,
  readMessage,
  STATE_CMD_PENDING,
  STATE_IDLE,
  STATE_RESULT_READY,
  STATE_SHUTDOWN,
  writeMessage,
} from "./kiro-ipc.js";
import type { BackendRunResult } from "./types.js";

let interrupted = false;
/** PID of the detached kiro-cli child process (set after init). */
let acpChildPid: number | undefined;

/** Signal the bridge to abort the current blocking wait. */
export function signalInterrupt(): void {
  interrupted = true;
  // Forward the signal to the detached child process group so kiro-cli
  // exits even though it doesn't share our process group.
  if (acpChildPid) {
    try {
      process.kill(-acpChildPid, "SIGTERM");
    } catch {
      /* child may already be gone */
    }
  }
}

export interface KiroSessionHandle {
  worker: Worker;
  controlBuffer: SharedArrayBuffer;
  dataBuffer: SharedArrayBuffer;
}

// biome-ignore lint/suspicious/noExplicitAny: worker responses are narrow per command — checked by caller
function sendCommand(handle: KiroSessionHandle, cmd: unknown): any {
  const control = new Int32Array(handle.controlBuffer);

  writeMessage(handle.dataBuffer, cmd);

  Atomics.store(control, 0, STATE_CMD_PENDING);
  Atomics.notify(control, 0);

  // Block until worker signals result. Poll with timeout so a signalInterrupt()
  // call from another handler can unblock us.
  while (
    Atomics.wait(control, 0, STATE_CMD_PENDING, POLL_INTERVAL_MS) ===
    "timed-out"
  ) {
    if (interrupted) {
      throw new Error("kiro bridge interrupted by signal");
    }
  }

  const result = readMessage(handle.dataBuffer);
  Atomics.store(control, 0, STATE_IDLE); // reset for next command
  Atomics.notify(control, 0); // wake worker waiting on Atomics.wait(control, 0, STATE_RESULT_READY)
  return result;
}

export function initKiroSession(opts: AcpClientOptions): KiroSessionHandle {
  const controlBuffer = new SharedArrayBuffer(4);
  const dataBuffer = new SharedArrayBuffer(DATA_BUFFER_SIZE);
  const control = new Int32Array(controlBuffer);
  Atomics.store(control, 0, STATE_IDLE);

  const workerPath = join(
    fileURLToPath(import.meta.url),
    "..",
    "kiro-worker.js",
  );
  const worker = new Worker(workerPath, {
    workerData: { controlBuffer, dataBuffer, verbose: opts.verbose ?? false },
  });

  const handle: KiroSessionHandle = { worker, controlBuffer, dataBuffer };
  const result = sendCommand(handle, { type: "init", opts });
  if (!result.ok)
    throw new Error("Failed to init kiro session: " + result.error);
  acpChildPid = result.childPid ?? undefined;
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
    errorCategory: result.timedOut
      ? "timeout"
      : result.error
        ? "non_zero_exit"
        : "none",
  };
}

export function setKiroSessionMode(
  handle: KiroSessionHandle,
  agentName: string,
): void {
  const result = sendCommand(handle, { type: "set_mode", agentName });
  if (!result.ok) {
    // Non-fatal: log but don't crash the loop
    process.stderr.write(
      `[autoloop] warning: failed to set kiro agent mode "${agentName}": ${result.error}\n`,
    );
  }
}

export function terminateKiroSession(handle: KiroSessionHandle): void {
  sendCommand(handle, { type: "terminate" });
  acpChildPid = undefined;
  // Drain stderr — worker thread process.stderr.write() calls from
  // sessionUpdate callbacks may still be in-flight. A brief sync sleep
  // lets them flush before we kill the worker.
  const drain = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(drain, 0, 0, 50);
  // Signal shutdown
  const control = new Int32Array(handle.controlBuffer);
  Atomics.store(control, 0, STATE_SHUTDOWN);
  Atomics.notify(control, 0);
  handle.worker.terminate();
}
