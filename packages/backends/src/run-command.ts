import { execSync } from "node:child_process";
import { shellQuote, shellWords } from "@mobrienv/autoloop-core";
import type { BackendRunResult } from "./types.js";

export function buildCommandInvocation(
  spec: { command: string; args: string[]; promptMode: string },
  prompt: string,
): string {
  const argv = shellWords([spec.command, ...spec.args]);
  // "file" mode: harness already writes the prompt to $AUTOLOOP_PROMPT_PATH
  // (see promptRuntimeEnvLines in backends/src/index.ts). Pipe that file into
  // the backend's stdin — avoids argv-size limits and shell re-quoting for
  // large prompts (e.g. claude -p chokes on ~12KB argv-mode prompts).
  if (spec.promptMode === "file") {
    return `${argv} < "$AUTOLOOP_PROMPT_PATH"`;
  }
  if (spec.promptMode === "stdin") {
    return `printf '%s' ${shellQuote(prompt)} | ${argv}`;
  }
  return `${argv} ${shellQuote(prompt)}`;
}

export function runShellCommand(
  providerKind: string,
  command: string,
  timeoutMs: number,
): BackendRunResult {
  try {
    const output = execSync(command, {
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "inherit"],
      shell: "/bin/sh",
      maxBuffer: 100 * 1024 * 1024,
    });
    return {
      output: output ?? "",
      exitCode: 0,
      timedOut: false,
      providerKind,
      errorCategory: "none",
    };
  } catch (err: unknown) {
    const e = err as {
      status?: number;
      killed?: boolean;
      stdout?: string;
      signal?: string;
      code?: string;
      message?: string;
    };
    if (
      e.killed ||
      e.signal === "SIGTERM" ||
      e.code === "ETIMEDOUT" ||
      e.message?.includes("ETIMEDOUT")
    ) {
      return {
        output: e.stdout ?? "",
        exitCode: 1,
        timedOut: true,
        providerKind,
        errorCategory: "timeout",
      };
    }
    return {
      output: e.stdout ?? "",
      exitCode: e.status ?? 1,
      timedOut: false,
      providerKind,
      errorCategory: "non_zero_exit",
    };
  }
}
