import { join } from "node:path";
import {
  normalizeBackendLabel,
  shellQuote,
  shellWords,
} from "@mobrienv/autoloop-core";
import { type AcpSession, sendAcpPrompt } from "./acp-client.js";
import {
  type ClaudeSdkSession,
  sendClaudeSdkPrompt,
} from "./claude-sdk-client.js";
import { type PiSession, sendPiPrompt } from "./pi-rpc-client.js";
import {
  buildCommandInvocation,
  runShellCommand,
  spawnShellCommand,
} from "./run-command.js";
import type { BackendCommandContext, BackendRunResult } from "./types.js";

export type {
  AcpProvider,
  AcpProviderId,
  ResolveAcpProviderInput,
} from "./acp-providers.js";
export {
  ACP_PROVIDERS,
  isAcpBackendKind,
  resolveAcpProvider,
} from "./acp-providers.js";
export type { CommandRisk } from "./command-risk.js";
export {
  classifyCommandRisk,
  commandFloorDecision,
  extractCommandFromToolInput,
  isCommandBearingTool,
  readSafetyAllowlist,
} from "./command-risk.js";
export type { BackendErrorClass } from "./error-class.js";
export { classifyBackendError, isRetryableErrorClass } from "./error-class.js";
export type {
  BackendCommandContext,
  BackendPaths,
  BackendRunResult,
  BackendSpec,
} from "./types.js";
export { normalizeBackendLabel };

/**
 * Drive one iteration against a live ACP session and map the result into the
 * uniform BackendRunResult shape the harness consumes for every backend kind.
 *
 * This is the async-native kiro path — it replaces the former sync bridge
 * (worker thread + SharedArrayBuffer) now that the harness iteration loop
 * itself is async.
 */
export async function runAcpIteration(
  session: AcpSession,
  prompt: string,
  timeoutMs: number,
): Promise<BackendRunResult> {
  const result = await sendAcpPrompt(session, prompt, timeoutMs);
  return {
    output: result.output,
    exitCode: result.error ? 1 : 0,
    timedOut: result.timedOut,
    providerKind: session.provider.id,
    errorCategory: result.timedOut
      ? "timeout"
      : result.error
        ? "non_zero_exit"
        : "none",
  };
}

export const runKiroIteration = runAcpIteration;

/**
 * Drive one iteration against a live pi RPC session (`pi --mode rpc`) and map
 * the result into the uniform BackendRunResult shape. The session-based path
 * replaces the former one-shot python bridge (`pi -p --mode json`) for the
 * main loop and reviews; parallel waves still use the process-per-task shim.
 */
export async function runPiIteration(
  session: PiSession,
  prompt: string,
  timeoutMs: number,
  streamLogPath?: string,
): Promise<BackendRunResult> {
  session.streamLogPath = streamLogPath;
  const result = await sendPiPrompt(session, prompt, timeoutMs);
  return {
    output: failureOutput(result.output, result.error),
    exitCode: result.error ? 1 : 0,
    timedOut: result.timedOut,
    providerKind: "pi",
    errorCategory: result.timedOut
      ? "timeout"
      : result.error
        ? "non_zero_exit"
        : "none",
  };
}

/**
 * Drive one iteration against a live Claude Agent SDK session and map the
 * result into the uniform BackendRunResult shape. The streaming-input session
 * is what enables live control: interrupt() of the in-flight turn and
 * mid-turn steering via queued user messages.
 */
export async function runClaudeSdkIteration(
  session: ClaudeSdkSession,
  prompt: string,
  timeoutMs: number,
  streamLogPath?: string,
): Promise<BackendRunResult> {
  session.streamLogPath = streamLogPath;
  const result = await sendClaudeSdkPrompt(session, prompt, timeoutMs);
  return {
    output: failureOutput(result.output, result.error, "claude-sdk"),
    exitCode: result.error ? 1 : 0,
    timedOut: result.timedOut,
    providerKind: "claude-sdk",
    errorCategory: result.timedOut
      ? "timeout"
      : result.error
        ? "non_zero_exit"
        : "none",
  };
}

/**
 * Keep the error detail in the journaled output on failure — exit codes alone
 * make failed iterations undiagnosable after the fact.
 */
function failureOutput(
  output: string,
  error: string | undefined,
  label = "pi",
): string {
  if (!error) return output;
  return output
    ? `${output}\n\n${label} error: ${error}`
    : `${label} error: ${error}`;
}

/**
 * A "mock" backend is any invocation whose command or argv mentions
 * `mock-backend` — used by tests to stub out real provider calls without
 * gating on kind. Intentionally a loose string match so test fixtures
 * can invoke `node path/to/mock-backend.js` directly.
 */
function isMockInvocation(command: string, args: string[]): boolean {
  if (command.includes("mock-backend")) return true;
  return args.some((arg) => arg.includes("mock-backend"));
}

export function buildBackendShellCommand(ctx: BackendCommandContext): string {
  const promptPath = join(ctx.paths.stateDir, "active-prompt.md");
  let envLines = promptRuntimeEnvLines(
    ctx.spec,
    ctx.prompt,
    promptPath,
    ctx.runtimeEnv,
  );
  if (ctx.usageFilePath) {
    envLines += `export AUTOLOOP_USAGE_FILE=${shellQuote(ctx.usageFilePath)}\n`;
  }
  const childCommand =
    ctx.spec.kind === "pi"
      ? shellWords([
          ctx.paths.piAdapterPath,
          ctx.spec.command,
          ...ctx.spec.args,
        ])
      : buildCommandInvocation(headlessShellSpec(ctx.spec), ctx.prompt);
  return envLines + wrapProcessInvocation(childCommand);
}

/**
 * One-shot shell fallback for the claude-sdk backend — parallel waves run
 * process-per-task instead of through the SDK session. The SDK spec carries
 * no CLI args, so inject the headless flags the legacy command path uses;
 * a bare `claude <prompt>` would open the interactive UI and hang until the
 * wave timeout.
 */
function headlessShellSpec(
  spec: BackendCommandContext["spec"],
): BackendCommandContext["spec"] {
  if (spec.kind !== "claude-sdk") return spec;
  const args = [...spec.args];
  if (!args.includes("-p")) args.unshift("-p");
  if (!args.includes("--dangerously-skip-permissions")) {
    args.push("--dangerously-skip-permissions");
  }
  return { ...spec, args };
}

export function runBackendCommand(
  providerKind: string,
  command: string,
  timeoutMs: number,
): BackendRunResult {
  return runShellCommand(providerKind, command, timeoutMs);
}

/**
 * Async sibling of `runBackendCommand` — used for the `command` backend's
 * main-loop iterations so the harness can register a live PID (via `onSpawn`)
 * for interrupt signaling and keep servicing its own control-drain handler
 * while the child runs. See `spawnShellCommand` for the escalation contract.
 */
export function runBackendCommandAsync(
  providerKind: string,
  command: string,
  timeoutMs: number,
  onSpawn?: (pid: number) => void,
): Promise<BackendRunResult> {
  return spawnShellCommand(providerKind, command, timeoutMs, (pid) =>
    onSpawn?.(pid),
  );
}

export function normalizeProviderKind(spec: {
  kind: string;
  provider?: string;
  command: string;
  args: string[];
}): string {
  if (spec.kind === "pi") return "pi";
  if (spec.kind === "claude-sdk") return "claude-sdk";
  if (spec.kind === "acp") return `acp:${spec.provider || "generic"}`;
  if (spec.kind === "kiro") return "acp:kiro";
  if (isMockInvocation(spec.command, spec.args)) return "mock";
  return spec.kind || "command";
}

function promptRuntimeEnvLines(
  spec: { kind: string },
  prompt: string,
  promptPath: string,
  runtimeEnv: string,
): string {
  let lines =
    runtimeEnv +
    "export AUTOLOOP_PROMPT_PATH=" +
    shellQuote(promptPath) +
    "\n" +
    "printf '%s' " +
    shellQuote(prompt) +
    " > " +
    shellQuote(promptPath) +
    "\n";
  if (spec.kind !== "pi") {
    lines += `export AUTOLOOP_PROMPT=${shellQuote(prompt)}\n`;
  }
  return lines;
}

function wrapProcessInvocation(command: string): string {
  return (
    "autoloops_child_pid=''\n" +
    "autoloops_cleanup() {\n" +
    '  if [ -n "$autoloops_child_pid" ]; then\n' +
    '    kill "$autoloops_child_pid" 2>/dev/null || true\n' +
    '    wait "$autoloops_child_pid" 2>/dev/null || true\n' +
    "  fi\n" +
    "}\n" +
    // Cooperative interrupt: a SIGUSR1 delivered to this wrapper (by the
    // harness's live-control adapter) is forwarded to the real child without
    // tearing down the wrapper itself, so a well-behaved wrapped command can
    // trap USR1 and cancel gracefully. If it doesn't, the harness escalates
    // to SIGTERM/SIGKILL directly against this same wrapper pid, which the
    // INT/TERM trap below handles identically to a normal interrupt.
    "trap 'autoloops_cleanup; exit 130' INT TERM\n" +
    'trap \'[ -n "$autoloops_child_pid" ] && kill -USR1 "$autoloops_child_pid" 2>/dev/null || true\' USR1\n' +
    "(\n" +
    command +
    "\n) &\n" +
    "autoloops_child_pid=$!\n" +
    // `wait` returns as soon as a trapped signal fires (e.g. the USR1
    // forward above), even though the child it was waiting on is still
    // running — POSIX shells do not automatically resume an interrupted
    // wait. Loop until the child has actually exited so a well-behaved
    // command has the time it needs to shut down gracefully after USR1,
    // instead of the wrapper exiting out from under it (which would orphan
    // the child and hand the harness a bogus, premature exit status).
    "autoloops_status=1\n" +
    'while kill -0 "$autoloops_child_pid" 2>/dev/null; do\n' +
    '  wait "$autoloops_child_pid" 2>/dev/null\n' +
    "  autoloops_status=$?\n" +
    "done\n" +
    "trap - INT TERM USR1\n" +
    'exit "$autoloops_status"\n'
  );
}
