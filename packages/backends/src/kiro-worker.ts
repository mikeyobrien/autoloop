/**
 * Worker thread that holds a persistent ACP session.
 * Communicates with the main thread via SharedArrayBuffer + Atomics.
 *
 * Protocol lives in kiro-ipc.ts (encode/decode + state constants).
 *
 * Commands:
 *   { type: "init", opts }
 *   { type: "prompt", prompt, timeoutMs }
 *   { type: "set_mode", agentName }
 *   { type: "terminate" }
 */
import { workerData } from "node:worker_threads";
import type { AcpSession } from "./acp-client.js";
import {
  initAcpSession,
  sendAcpPrompt,
  terminateAcpSession,
} from "./acp-client.js";
import {
  readMessage,
  STATE_CMD_PENDING,
  STATE_IDLE,
  STATE_RESULT_READY,
  STATE_SHUTDOWN,
  writeMessage,
} from "./kiro-ipc.js";

const { controlBuffer, dataBuffer, verbose } = workerData as {
  controlBuffer: SharedArrayBuffer;
  dataBuffer: SharedArrayBuffer;
  verbose: boolean;
};

const control = new Int32Array(controlBuffer);

let session: AcpSession | null = null;

// biome-ignore lint/suspicious/noExplicitAny: command payloads are narrow, checked per-type below
async function handleCommand(cmd: any): Promise<unknown> {
  switch (cmd.type) {
    case "init": {
      session = await initAcpSession({ ...cmd.opts, verbose });
      return {
        ok: true,
        sessionId: session.sessionId,
        childPid: session.process.pid,
      };
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
    // Wait for main thread to signal a command (control[0] = STATE_CMD_PENDING)
    Atomics.wait(control, 0, STATE_IDLE);
    if (Atomics.load(control, 0) === STATE_SHUTDOWN) break;

    const cmd = readMessage(dataBuffer);
    let result: unknown;
    try {
      result = await handleCommand(cmd);
    } catch (err: unknown) {
      result = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    writeMessage(dataBuffer, result);
    Atomics.store(control, 0, STATE_RESULT_READY);
    Atomics.notify(control, 0);

    // Wait for main thread to ack (reset to IDLE) before looping, else
    // we'd immediately re-enter and read stale data.
    Atomics.wait(control, 0, STATE_RESULT_READY);
    // Bridge wakes us via notify after storing STATE_CMD_PENDING or
    // STATE_SHUTDOWN; either way the loop-head guard handles it.
  }
})();
