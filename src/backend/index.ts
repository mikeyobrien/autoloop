import { join } from "node:path";
import { normalizeBackendLabel, shellQuote } from "@mobrienv/autoloop-core";
import { buildCommandInvocation, runShellCommand } from "./run-command.js";
import { mockBackend } from "./run-mock.js";
import { buildPiAdapterInvocation } from "./run-pi.js";
import type { BackendCommandContext, BackendRunResult } from "./types.js";

export type {
  BackendCommandContext,
  BackendRunResult,
  BackendSpec,
} from "./types.js";

export { normalizeBackendLabel };

export function buildBackendShellCommand(ctx: BackendCommandContext): string {
  const promptPath = join(ctx.loop.paths.stateDir, "active-prompt.md");
  const envLines = promptRuntimeEnvLines(
    ctx.spec,
    ctx.prompt,
    promptPath,
    ctx.runtimeEnv,
  );
  const childCommand =
    ctx.spec.kind === "pi"
      ? buildPiAdapterInvocation(ctx.loop, ctx.spec)
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
  if (mockBackend(spec.command, spec.args)) return "mock";
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
