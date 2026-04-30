import { join } from "node:path";
import {
  normalizeBackendLabel,
  shellQuote,
  shellWords,
} from "@mobrienv/autoloop-core";
import { type AcpSession, sendAcpPrompt } from "./acp-client.js";
import { buildCommandInvocation, runShellCommand } from "./run-command.js";
import type { BackendCommandContext, BackendRunResult } from "./types.js";

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
  const envLines = promptRuntimeEnvLines(
    ctx.spec,
    ctx.prompt,
    promptPath,
    ctx.runtimeEnv,
  );
  const childCommand =
    ctx.spec.kind === "pi"
      ? shellWords([
          ctx.paths.piAdapterPath,
          ctx.spec.command,
          ...ctx.spec.args,
        ])
      : buildCommandInvocation(ctx.spec, ctx.prompt);
  return envLines + wrapProcessInvocation(childCommand);
}

export function runBackendCommand(
  providerKind: string,
  command: string,
  timeoutMs: number,
): BackendRunResult {
  return runShellCommand(providerKind, command, timeoutMs);
}

export function normalizeProviderKind(spec: {
  kind: string;
  command: string;
  args: string[];
}): string {
  if (spec.kind === "pi") return "pi";
  if (spec.kind === "kiro") return "kiro";
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
    "trap 'autoloops_cleanup; exit 130' INT TERM\n" +
    "(\n" +
    command +
    "\n) &\n" +
    "autoloops_child_pid=$!\n" +
    'wait "$autoloops_child_pid"\n' +
    "autoloops_status=$?\n" +
    "trap - INT TERM\n" +
    'exit "$autoloops_status"\n'
  );
}
