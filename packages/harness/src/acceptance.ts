import { spawnSync } from "node:child_process";
import { jsonBool, jsonField, jsonFieldRaw } from "@mobrienv/autoloop-core";
import {
  appendEvent,
  appendOperatorEvent,
} from "@mobrienv/autoloop-core/journal";
import { lastNChars } from "./display.js";
import type { LoopContext } from "./types.js";

export interface AcceptanceFailure {
  command: string;
  exitCode: number;
  timedOut: boolean;
  tail: string;
}

export interface AcceptanceResult {
  /** False when no verify commands are configured (gate is a no-op). */
  ran: boolean;
  /** True when the gate ran and every command exited 0. */
  passed: boolean;
  failures: AcceptanceFailure[];
}

const TAIL_CHARS = 2000;

/**
 * Run the out-of-band acceptance gate for a done-claim. The HARNESS executes
 * each `verifyCmds` entry in a clean shell rooted at the work dir — never the
 * agent's session — so the pass/fail status is captured harness-side and cannot
 * be faked by a prompt. Returns `passed: true` (and `ran: false`) when no
 * commands are configured, preserving prior completion behavior.
 *
 * Every command's exit code and output tail is journaled as a verification
 * artifact regardless of outcome.
 */
export function runAcceptanceGate(
  loop: LoopContext,
  iteration: number,
): AcceptanceResult {
  const commands = loop.acceptance.verifyCmds;
  const iter = String(iteration);
  if (commands.length === 0) {
    return { ran: false, passed: true, failures: [] };
  }

  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    iter,
    "acceptance.start",
    jsonField("count", String(commands.length)),
  );

  const failures: AcceptanceFailure[] = [];
  for (const command of commands) {
    const res = spawnSync(command, {
      shell: "/bin/sh",
      cwd: loop.paths.workDir,
      encoding: "utf-8",
      timeout: loop.acceptance.timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
    });
    const timedOut =
      res.signal === "SIGTERM" ||
      (res.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
    const exitCode = timedOut ? 124 : (res.status ?? 1);
    const tail = lastNChars(
      `${res.stdout ?? ""}${res.stderr ?? ""}`,
      TAIL_CHARS,
    );

    appendEvent(
      loop.paths.journalFile,
      loop.runtime.runId,
      iter,
      "acceptance.command",
      jsonField("command", command) +
        ", " +
        jsonField("exit_code", String(exitCode)) +
        ", " +
        jsonFieldRaw("timed_out", jsonBool(timedOut)) +
        ", " +
        jsonField("output_tail", tail),
    );

    if (exitCode !== 0) {
      failures.push({ command, exitCode, timedOut, tail });
    }
  }

  const passed = failures.length === 0;
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    iter,
    "acceptance.result",
    jsonFieldRaw("passed", jsonBool(passed)) +
      ", " +
      jsonField("failed", String(failures.length)) +
      ", " +
      jsonField("total", String(commands.length)),
  );

  return { ran: true, passed, failures };
}

/**
 * Re-inject a failed acceptance gate's output as operator guidance so the next
 * iteration's prompt carries the concrete failure instead of completing. This
 * is the "do not complete; fix it" path of a deterministic gate.
 */
export function reinjectAcceptanceFailure(
  loop: LoopContext,
  iteration: number,
  result: AcceptanceResult,
): void {
  const detail = result.failures
    .map(
      (f) =>
        `- \`${f.command}\` exited ${f.exitCode}${f.timedOut ? " (timed out)" : ""}:\n${f.tail}`,
    )
    .join("\n\n");
  const message =
    "Completion was blocked: the harness acceptance gate failed. " +
    "Do not announce completion until every verify command passes. " +
    `Failing command(s):\n\n${detail}`;
  appendOperatorEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "operator.guidance",
    message,
  );
}
