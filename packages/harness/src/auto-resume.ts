// T-030: arm a process-free auto-resume for timed waits.
//
// When a wait.request carries a positive duration (durationMs > 0), the
// harness spawns a fully detached sleeper child (our own timer — not /ops,
// not a second supervisor product) that survives this process exiting 0.
// After the duration the child re-checks registry + journal (idempotent vs
// a manual Wake/steer resume) and, only if this same wait.open is still the
// latest unmatched open, invokes the EXISTING resume path
// (`<selfCommand> resume <runId>`), which journals wait.close + loop.resume
// on the same run_id. durationMs == 0 (or absent) keeps indefinite parking
// exactly as before: no child is spawned at all.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { log } from "./display.js";
import type { LoopContext } from "./types.js";
import type { WaitRequest } from "./wait.js";

/** Absolute path to the detached sleeper entry (dist sibling of this file). */
export function autoResumeChildPath(): string {
  return fileURLToPath(new URL("./auto-resume-child.js", import.meta.url));
}

/**
 * Parent directory that holds the `<projectDir>/.autoloop` state dir the
 * registry lives in. The resume CLI resolves the registry from
 * `AUTOLOOP_PROJECT_DIR` + `.autoloop/registry.jsonl`, so the child must be
 * re-anchored here — it does not inherit the engine's environment.
 */
export function registryProjectRoot(registryFile: string): string {
  const firstSep = registryFile.lastIndexOf("/");
  const stateParent =
    firstSep > 0 ? registryFile.slice(0, firstSep) : registryFile;
  const secondSep = stateParent.lastIndexOf("/");
  return secondSep > 0 ? stateParent.slice(0, secondSep) : stateParent;
}

/**
 * Arm the detached auto-resume timer for a park that carries durationMs > 0.
 * No-op for indefinite parks. Must be called only after wait.open is
 * journaled and the run is registered `waiting` (i.e. after stopWaiting).
 */
export function armAutoResume(
  loop: LoopContext,
  waitId: string,
  request: WaitRequest,
): void {
  if (request.durationMs <= 0) return;
  const spec = [
    loop.paths.registryFile,
    loop.paths.journalFile,
    loop.runtime.runId,
    waitId,
    String(request.durationMs),
    registryProjectRoot(loop.paths.registryFile),
    loop.runtime.selfCommand,
    loop.paths.stateDir,
  ];
  const child = spawn(
    process.execPath,
    [autoResumeChildPath(), JSON.stringify(spec)],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  log(
    loop,
    "info",
    `wait auto-resume armed wait_id=${waitId} duration_ms=${request.durationMs} child_pid=${child.pid ?? "?"}`,
  );
}
