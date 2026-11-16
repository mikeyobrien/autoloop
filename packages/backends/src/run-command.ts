import {
  type ChildProcess,
  execFileSync,
  execSync,
  spawn,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  killProcessTree,
  processGroupSpawnOptions,
  resolvePosixShell,
  shellQuote,
  shellWords,
} from "@mobrienv/autoloop-core";
import {
  type BackendEnvironmentPolicy,
  resolveBackendEnvironment,
} from "./environment.js";
import type { BackendRunResult } from "./types.js";

export interface ShellCommandOptions {
  projectDir?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  environmentPolicy?: BackendEnvironmentPolicy;
}

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

/**
 * How the shell gets the backend script: argv after the shell path, plus the
 * temporary script file to delete when the shell ends (win32 only).
 */
export interface ShellScript {
  args: string[];
  scriptPath?: string;
}

/**
 * POSIX: `-c <command>`. win32: the command goes to a temporary UTF-8 script
 * file (written as is, so LF stays LF) and the shell runs that file. A long
 * `sh.exe -c` argument fails on win32: the command line holds at most 32,767
 * characters (`ENAMETOOLONG`), and the MSYS parser of Git for Windows breaks
 * long scripts with quotes or non-ASCII text.
 */
export function prepareShellScript(
  command: string,
  platform: NodeJS.Platform = process.platform,
): ShellScript {
  if (platform !== "win32") return { args: ["-c", command] };
  const scriptPath = join(
    tmpdir(),
    `autoloop-backend-script-${process.pid}-${randomUUID()}.sh`,
  );
  writeFileSync(scriptPath, command, { encoding: "utf-8", flag: "wx" });
  return { args: [scriptPath], scriptPath };
}

/** Delete the temporary script file of `prepareShellScript`, if any. */
export function removeShellScript(script: ShellScript): void {
  if (script.scriptPath === undefined) return;
  try {
    rmSync(script.scriptPath, { force: true });
  } catch {
    /* a leftover file in the temp directory is not a backend failure */
  }
}

/**
 * Resolve the POSIX shell that runs backend commands and prepare the script
 * argv. On win32 a missing Git for Windows `sh.exe` throws
 * `PosixShellNotFoundError`, and the temp script file can fail to write;
 * report either as a backend failure (same shape as a spawn error) instead of
 * crashing the caller.
 */
function prepareCommandShell(
  providerKind: string,
  command: string,
  env: NodeJS.ProcessEnv,
): { shell: string; script: ShellScript } | { failure: BackendRunResult } {
  try {
    const shell = resolvePosixShell(env);
    return { shell, script: prepareShellScript(command) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      failure: {
        output: `command spawn error: ${message}`,
        exitCode: 1,
        timedOut: false,
        providerKind,
        errorCategory: "non_zero_exit",
      },
    };
  }
}

/**
 * Whether the follow-up kill 5s after a timeout kill runs. POSIX always
 * escalates SIGTERM to SIGKILL. win32 retries `taskkill /T /F` once, only
 * while the child has not settled: the first taskkill can fail (access
 * denied, or its own spawnSync timeout). Node holds the child's process handle
 * until it exits, so its pid cannot be reused while it is unsettled.
 */
export function escalatesTimeoutKill(
  settled: boolean,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform !== "win32" || !settled;
}

export function runShellCommand(
  providerKind: string,
  command: string,
  timeoutMs: number,
  options: ShellCommandOptions = {},
): BackendRunResult {
  const sourceEnv = options.env ?? process.env;
  const env = resolveBackendEnvironment(sourceEnv, {
    projectDir: options.projectDir ?? options.cwd ?? process.cwd(),
    policy: options.environmentPolicy,
  });
  const prepared = prepareCommandShell(providerKind, command, env);
  if ("failure" in prepared) return prepared.failure;
  const { shell, script } = prepared;
  const execOptions = {
    encoding: "utf-8" as const,
    timeout: timeoutMs,
    stdio: ["pipe", "pipe", "inherit"] as ["pipe", "pipe", "inherit"],
    maxBuffer: 100 * 1024 * 1024,
    cwd: options.cwd,
    env,
  };
  try {
    const output =
      script.scriptPath === undefined
        ? execSync(command, { ...execOptions, shell })
        : execFileSync(shell, script.args, execOptions);
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
  } finally {
    removeShellScript(script);
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
  options: ShellCommandOptions = {},
): Promise<BackendRunResult> {
  const env = resolveBackendEnvironment(options.env ?? process.env, {
    projectDir: options.projectDir ?? options.cwd ?? process.cwd(),
    policy: options.environmentPolicy,
  });
  const prepared = prepareCommandShell(providerKind, command, env);
  if ("failure" in prepared) return Promise.resolve(prepared.failure);
  const { shell, script } = prepared;
  return new Promise((resolve) => {
    // POSIX: `detached: true` makes the child a process-group leader, so a
    // timeout kill can target the whole group (`-pid`) rather than only the
    // `/bin/sh` process itself — dash (this repo's `/bin/sh`) forks rather
    // than exec-replacing for anything but a single tail-call command, so a
    // plain `child.kill()` can otherwise leave the real work (e.g.
    // `sleep 30`) running as an orphaned grandchild. `onSpawn`'s pid is
    // unaffected: the group leader's pid is the same pid callers already
    // signal directly (e.g. the harness's SIGUSR1 interrupt path targets this
    // same pid). win32: no process group; `killProcessTree` runs
    // `taskkill /T /F` against the shell's pid instead.
    let child: ChildProcess;
    try {
      child = spawn(shell, script.args, {
        stdio: ["pipe", "pipe", "inherit"],
        ...processGroupSpawnOptions(),
        cwd: options.cwd,
        env,
      });
    } catch (err) {
      // A synchronous spawn throw rejects the promise, as before.
      removeShellScript(script);
      throw err;
    }
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
      removeShellScript(script);
      resolve(result);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      if (bufferedBytes >= MAX_BUFFER_BYTES) return;
      bufferedBytes += chunk.length;
      stdout += chunk.toString("utf-8");
    });

    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) killProcessTree(child.pid, signal);
        else child.kill(signal);
      } catch {
        /* already exited */
      }
    };

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killGroup("SIGTERM");
        // Escalate to SIGKILL (win32: retry taskkill) if it doesn't exit
        // promptly.
        setTimeout(() => {
          if (escalatesTimeoutKill(settled)) killGroup("SIGKILL");
        }, 5000);
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
