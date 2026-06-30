// stdio transport wiring for the ACP agent.
//
// Builds a bidirectional NDJSON stream over the process's stdin/stdout and
// constructs an AgentSideConnection backed by AutoloopAgent. Stdout carries the
// protocol frames, so nothing else may write to it while the connection lives
// (quick commands are captured; logs go to stderr).

import * as acp from "@agentclientprotocol/sdk";
import { type AgentDeps, AutoloopAgent } from "./agent.js";

/**
 * Start the ACP agent over the given Node streams. Resolves when the
 * connection closes (stdin ends or the stream errors).
 */
export async function serveAcp(
  deps: AgentDeps,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  const writable = nodeWritableToWeb(output);
  const readable = nodeReadableToWeb(input);
  const stream = acp.ndJsonStream(writable, readable);

  let agent: AutoloopAgent | undefined;
  const conn = new acp.AgentSideConnection((connection) => {
    agent = new AutoloopAgent(connection, deps);
    return agent;
  }, stream);

  // Tear down the dashboard and any active turns when the client disconnects.
  conn.signal.addEventListener("abort", () => {
    void agent?.shutdown();
  });

  await conn.closed;
  await agent?.shutdown();
}

/** Adapt a Node readable stream into a web ReadableStream<Uint8Array>. */
export function nodeReadableToWeb(
  input: NodeJS.ReadableStream,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      input.on("data", (chunk: Buffer | string) => {
        controller.enqueue(
          typeof chunk === "string"
            ? new TextEncoder().encode(chunk)
            : new Uint8Array(chunk),
        );
      });
      input.on("end", () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
      input.on("error", (err) => controller.error(err));
    },
    cancel() {
      if (typeof (input as NodeJS.ReadStream).destroy === "function") {
        (input as NodeJS.ReadStream).destroy();
      }
    },
  });
}

/** Adapt a Node writable stream into a web WritableStream<Uint8Array>. */
export function nodeWritableToWeb(
  output: NodeJS.WritableStream,
): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        output.write(Buffer.from(chunk), (err) =>
          err ? reject(err) : resolve(),
        );
      });
    },
  });
}
