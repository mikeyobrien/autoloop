// Durable suspend/resume signalling for the lifecycle hooks engine.
//
// `on_error = "suspend"` writes a versioned `.autoloop/suspend-state.json`
// and (for in-process phases) blocks the harness until an operator drops
// `.autoloop/resume-requested` (or `autoloop hooks clear-suspend` / `resume`
// clears it). This lets a hook halt the loop for out-of-band remediation
// (e.g. a human approval gate) without losing the run's position.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { jsonField } from "@mobrienv/autoloop-core";
import {
  isSuspendState,
  SUSPEND_STATE_SCHEMA_VERSION,
  type SuspendState,
} from "@mobrienv/autoloop-core/hooks-schema";
import { appendEvent } from "@mobrienv/autoloop-core/journal";

export type { SuspendState };
export { SUSPEND_STATE_SCHEMA_VERSION };

export function suspendStatePath(stateDir: string): string {
  return join(stateDir, "suspend-state.json");
}

export function resumeRequestPath(stateDir: string): string {
  return join(stateDir, "resume-requested");
}

/**
 * Write the suspend state atomically (tmp file + rename) so a reader never
 * observes a torn write, and journal `hook.suspend` for observability.
 */
export function writeSuspendState(
  stateDir: string,
  state: Omit<SuspendState, "schemaVersion">,
  journalFile?: string,
): SuspendState {
  mkdirSync(stateDir, { recursive: true });
  const full: SuspendState = {
    schemaVersion: SUSPEND_STATE_SCHEMA_VERSION,
    ...state,
  };
  const path = suspendStatePath(stateDir);
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(full, null, 2)}\n`, "utf-8");
  renameSync(tmp, path);

  if (journalFile) {
    appendEvent(
      journalFile,
      state.runId,
      state.iteration ? String(state.iteration) : "",
      "hook.suspend",
      jsonField("phase", state.phase) +
        ", " +
        jsonField("reason", state.reason) +
        ", " +
        jsonField("hook_command", state.hookCommand) +
        ", " +
        jsonField("resume_iteration", String(state.resumeIteration)),
    );
  }

  return full;
}

/** Read the durable suspend state, or null when absent/unreadable/invalid. */
export function readSuspendState(stateDir: string): SuspendState | null {
  const path = suspendStatePath(stateDir);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return isSuspendState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Remove the suspend-state file. No-op if absent. */
export function clearSuspendState(stateDir: string): boolean {
  const path = suspendStatePath(stateDir);
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}

/** Drop the resume-requested signal file (operator says "go"). */
export function requestResume(stateDir: string): void {
  mkdirSync(dirname(resumeRequestPath(stateDir)), { recursive: true });
  writeFileSync(resumeRequestPath(stateDir), `${new Date().toISOString()}\n`);
}

export function resumeRequested(stateDir: string): boolean {
  return existsSync(resumeRequestPath(stateDir));
}

/** Remove the resume-requested signal file. No-op if absent. */
export function clearResumeRequest(stateDir: string): boolean {
  const path = resumeRequestPath(stateDir);
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}

export interface WaitForResumeOptions {
  pollMs?: number;
  /** Abort signal, honoured the same way `ask.ts:awaitHumanResponse` does. */
  signal?: AbortSignal;
  /** Optional wall-clock cap in ms; 0/undefined = wait indefinitely. */
  timeoutMs?: number;
}

/**
 * Block until `resume-requested` appears, the run is aborted, or (if set)
 * `timeoutMs` elapses. Returns `true` when resumed, `false` on abort/timeout.
 * Mirrors `ask.ts:awaitHumanResponse`'s signal-aware poll loop.
 */
export async function waitForResume(
  stateDir: string,
  opts: WaitForResumeOptions = {},
): Promise<boolean> {
  const pollMs = opts.pollMs && opts.pollMs > 0 ? opts.pollMs : 1000;
  const deadline =
    opts.timeoutMs && opts.timeoutMs > 0 ? Date.now() + opts.timeoutMs : null;

  for (;;) {
    if (opts.signal?.aborted) return false;
    if (resumeRequested(stateDir)) return true;
    if (deadline !== null && Date.now() >= deadline) return false;
    const wait =
      deadline !== null ? Math.min(pollMs, deadline - Date.now()) : pollMs;
    await sleep(Math.max(0, wait));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
