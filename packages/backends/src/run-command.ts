import { type ChildProcess, execSync, spawn } from "node:child_process";
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

const MAX_BUFFER_BYTES = 100 * 1024 * 1024;

/**
 * Async, non-blocking sibling of `runShellCommand`. Unlike `execSync`, this
 * does not block the Node event loop while the child runs, so the harness can
 * (a) hand the caller a live PID via `onSpawn` for interrupt signaling and (b)
 * keep servicing its own SIGUSR1 control-drain handler while a `command`
 * backend iteration is in flight. Reproduces the same `BackendRunResult`
 * shape (`timedOut`/`errorCategory`) as `runShellCommand` so downstream error
 * classification in `iteration.ts` is unaffected.
 */
export function spawnShellCommand(
  providerKind: string,
  command: string,
  timeoutMs: number,
  onSpawn?: (pid: number, child: ChildProcess) => void,
): Promise<BackendRunResult> {
  return new Promise((resolve) => {
    // `detached: true` makes the child a process-group leader, so a timeout
    // kill can target the whole group (`-pid`) rather than only the `/bin/sh`
    // process itself — dash (this repo's `/bin/sh`) forks rather than
    // exec-replacing for anything but a single tail-call command, so a plain
    // `child.kill()` can otherwise leave the real work (e.g. `sleep 30`)
    // running as an orphaned grandchild. `onSpawn`'s pid is unaffected: the
    // group leader's pid is the same pid callers already signal directly
    // (e.g. the harness's SIGUSR1 interrupt path targets this same pid).
    const child = spawn("/bin/sh", ["-c", command], {
      stdio: ["pipe", "pipe", "inherit"],
      detached: true,
    });
    if (child.pid) onSpawn?.(child.pid, child);

    let stdout = "";
    let bufferedBytes = 0;
    let timedOut = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (result: BackendRunResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      if (bufferedBytes >= MAX_BUFFER_BYTES) return;
      bufferedBytes += chunk.length;
      stdout += chunk.toString("utf-8");
    });

    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        /* already exited */
      }
    };

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killGroup("SIGTERM");
        // Escalate to SIGKILL if it doesn't exit promptly.
        setTimeout(() => killGroup("SIGKILL"), 5000);
      }, timeoutMs);
    }

    child.on("error", (err) => {
      finish({
        output: stdout || `command spawn error: ${err.message}`,
        exitCode: 1,
        timedOut,
        providerKind,
        errorCategory: timedOut ? "timeout" : "non_zero_exit",
      });
    });

    child.on("close", (code, signal) => {
      if (timedOut || signal === "SIGTERM" || signal === "SIGKILL") {
        finish({
          output: stdout,
          exitCode: code ?? 1,
          timedOut: true,
          providerKind,
          errorCategory: "timeout",
        });
        return;
      }
      finish({
        output: stdout,
        exitCode: code ?? 0,
        timedOut: false,
        providerKind,
        errorCategory: code && code !== 0 ? "non_zero_exit" : "none",
      });
    });
  });
}
