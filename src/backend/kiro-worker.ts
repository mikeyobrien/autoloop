/**
 * Worker thread that holds a persistent ACP session.
 * Communicates with the main thread via SharedArrayBuffer + Atomics.
 *
 * Protocol:
 *   Main → Worker: write JSON command to dataBuffer, signal controlBuffer[0] = 1
 *   Worker → Main: write JSON result to dataBuffer, signal controlBuffer[0] = 2
 *   Commands: { type: "init", opts } | { type: "prompt", prompt, timeoutMs } | { type: "terminate" }
 */
import { parentPort, workerData } from "node:worker_threads";
import type { AcpSession } from "./acp-client.js";
import {
  initAcpSession,
  sendAcpPrompt,
  terminateAcpSession,
} from "./acp-client.js";

const { controlBuffer, dataBuffer } = workerData as {
  controlBuffer: SharedArrayBuffer;
  dataBuffer: SharedArrayBuffer;
};

const control = new Int32Array(controlBuffer);
const data = new Uint8Array(dataBuffer);
const decoder = new TextDecoder();
const encoder = new TextEncoder();

let session: AcpSession | null = null;

function readCommand(): unknown {
  const len = new DataView(dataBuffer).getUint32(0);
  const json = decoder.decode(data.slice(4, 4 + len));
  return JSON.parse(json);
}

function writeResult(result: unknown): void {
  const json = encoder.encode(JSON.stringify(result));
  new DataView(dataBuffer).setUint32(0, json.length);
  data.set(json, 4);
}

async function handleCommand(cmd: any): Promise<unknown> {
  switch (cmd.type) {
    case "init": {
      session = await initAcpSession(cmd.opts);
      return { ok: true, sessionId: session.sessionId };
    }
    case "prompt": {
      if (!session) return { ok: false, error: "no session" };
      const result = await sendAcpPrompt(session, cmd.prompt, cmd.timeoutMs);
      return { ok: true, ...result };
    }
    case "set_mode": {
      if (!session) return { ok: false, error: "no session" };
      try {
        await session.connection.setSessionMode({
          sessionId: session.sessionId,
          modeId: cmd.agentName,
        });
        return { ok: true };
      } catch (err: unknown) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    case "terminate": {
      if (session) await terminateAcpSession(session);
      session = null;
      return { ok: true };
    }
    default:
      return { ok: false, error: "unknown command: " + cmd.type };
  }
}

(async () => {
  while (true) {
    // Wait for main thread to signal a command (control[0] = 1)
    Atomics.wait(control, 0, 0);
    if (Atomics.load(control, 0) === 3) break; // shutdown signal

    const cmd = readCommand();
    let result: unknown;
    try {
      result = await handleCommand(cmd);
    } catch (err: unknown) {
      result = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    writeResult(result);
    Atomics.store(control, 0, 2); // signal result ready
    Atomics.notify(control, 0);

    // Wait for main thread to acknowledge (reset to 0) before looping,
    // otherwise we'd immediately re-enter and read stale data.
    Atomics.wait(control, 0, 2);
  }
})();
