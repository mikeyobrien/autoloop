// Finish notifications: run a user-configured command when a loop ends.
//
// Config (autoloops.toml):
//   notify.command    — shell command to run; "" (default) disables notifications
//   notify.on         — CSV of stop-reason classes to notify on
//                       (completed | failed | stopped); default "completed,failed"
//   notify.timeout_ms — max time the command may run; default 10000
//
// The command receives AUTOLOOP_* env vars and a JSON payload on stdin.
// Everything here is best-effort: this module never throws.

import { spawnSync } from "node:child_process";
import { jsonField } from "@mobrienv/autoloop-core";
import * as config from "@mobrienv/autoloop-core/config";
import { appendEvent } from "@mobrienv/autoloop-core/journal";
import type { StopReason } from "./types.js";

export interface FinishNotificationOptions {
  projectDir: string;
  journalFile: string;
  runId: string;
  preset: string;
  stopReason: StopReason;
  iterations: number;
}

export interface FinishNotificationResult {
  status: "disabled" | "skipped" | "sent" | "failed";
  detail?: string;
}

export type StopReasonClass = "completed" | "failed" | "stopped";

/**
 * The `startsWith("completion")` check relies on the `completion_*` naming
 * convention holding across the `StopReason` union — if a future literal is
 * added that starts with "completion" but is not a success case, this
 * classifier will misclassify it as `"completed"`.
 */
export function classifyStopReason(stopReason: StopReason): StopReasonClass {
  if (stopReason === "completed" || stopReason.startsWith("completion"))
    return "completed";
  if (
    stopReason === "backend_failed" ||
    stopReason === "backend_timeout" ||
    // A held loop (UNKNOWN metareview verdict) needs human attention, so it
    // rides the same notify class as a failure rather than a quiet stop.
    stopReason === "review_unknown"
  )
    return "failed";
  return "stopped";
}

export function runFinishNotification(
  opts: FinishNotificationOptions,
): FinishNotificationResult {
  let command = "";
  try {
    const cfg = config.loadProject(opts.projectDir);
    command = config.get(cfg, "notify.command", "").trim();
    if (!command) return { status: "disabled" };

    const onClasses = config
      .get(cfg, "notify.on", "completed,failed")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const reasonClass = classifyStopReason(opts.stopReason);
    if (!onClasses.includes(reasonClass))
      return { status: "skipped", detail: reasonClass };

    const timeoutMs = config.getInt(cfg, "notify.timeout_ms", 10000);
    const payload = JSON.stringify({
      run_id: opts.runId,
      stop_reason: opts.stopReason,
      iterations: opts.iterations,
      preset: opts.preset,
      project_dir: opts.projectDir,
    });

    const result = spawnSync(command, {
      shell: true,
      input: payload,
      timeout: timeoutMs,
      env: {
        ...process.env,
        AUTOLOOP_RUN_ID: opts.runId,
        AUTOLOOP_STOP_REASON: opts.stopReason,
        AUTOLOOP_ITERATIONS: String(opts.iterations),
        AUTOLOOP_PRESET: opts.preset,
        AUTOLOOP_PROJECT_DIR: opts.projectDir,
      },
    });

    if (result.error || result.status !== 0) {
      const detail = result.error
        ? result.error.message
        : `exit ${result.status ?? `signal ${result.signal}`}: ${result.stderr?.toString() ?? ""}`;
      journalFailed(opts, command, detail);
      return { status: "failed", detail: tail(detail, 200) };
    }

    journalSent(opts, command);
    return { status: "sent" };
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    journalFailed(opts, command, detail);
    return { status: "failed", detail: tail(detail, 200) };
  }
}

function journalSent(opts: FinishNotificationOptions, command: string): void {
  try {
    appendEvent(
      opts.journalFile,
      opts.runId,
      "",
      "notify.sent",
      jsonField("command", command) +
        ", " +
        jsonField("stop_reason", opts.stopReason),
    );
  } catch {
    /* best-effort */
  }
}

function journalFailed(
  opts: FinishNotificationOptions,
  command: string,
  error: string,
): void {
  try {
    appendEvent(
      opts.journalFile,
      opts.runId,
      "",
      "notify.failed",
      jsonField("command", command) +
        ", " +
        jsonField("error", tail(error, 200)),
    );
  } catch {
    /* best-effort */
  }
}

function tail(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(-max);
}
