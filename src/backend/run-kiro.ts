import type { AcpSession } from "./acp-client.js";
import { sendAcpPrompt } from "./acp-client.js";
import type { BackendRunResult } from "./types.js";

export async function runKiroIteration(
  session: AcpSession,
  prompt: string,
  timeoutMs: number,
): Promise<BackendRunResult> {
  const result = await sendAcpPrompt(session, prompt, timeoutMs);
  return {
    output: result.output,
    exitCode: result.error ? 1 : 0,
    timedOut: result.timedOut,
    providerKind: "kiro",
    errorCategory: result.timedOut
      ? "timeout"
      : result.error
        ? "non_zero_exit"
        : "none",
  };
}
