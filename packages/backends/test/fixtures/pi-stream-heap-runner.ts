import { statSync } from "node:fs";
import { runPiIteration } from "@mobrienv/autoloop-backends";
import {
  initPiSession,
  terminatePiSession,
} from "@mobrienv/autoloop-backends/pi-rpc-client";

const eventCount = Number(process.env.PI_FIXTURE_EVENTS);
const payloadBytes = Number(process.env.PI_FIXTURE_PAYLOAD_BYTES);
const logPath = process.env.PI_FIXTURE_LOG_PATH;
const rpcFixture = process.env.PI_FIXTURE_RPC_PATH;

if (!eventCount || !payloadBytes || !logPath || !rpcFixture) {
  throw new Error("missing constrained Pi stream fixture environment");
}

const startedAt = Date.now();
const session = await initPiSession({
  command: rpcFixture,
  args: [`--fixture-events=${eventCount}`, `--fixture-payload=${payloadBytes}`],
  cwd: process.cwd(),
  handshakeTimeoutMs: 5_000,
});

try {
  const result = await runPiIteration(
    session,
    "exercise cumulative persistence",
    45_000,
    logPath,
  );
  process.stdout.write(
    `${JSON.stringify({
      eventCount,
      outputBytes: statSync(logPath).size,
      durationMs: Date.now() - startedAt,
      iterationExitCode: result.exitCode,
      errorCategory: result.errorCategory,
    })}\n`,
  );
} finally {
  await terminatePiSession(session);
}
