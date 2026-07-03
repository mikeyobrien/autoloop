import { spawnSync } from "node:child_process";
import { parseCriterion } from "./intent.js";

export type Reconcile = "confirmed" | "false_done" | "unverifiable";

export interface PostFireFailure {
  command: string;
  exitCode: number;
  tail: string;
}

export interface PostFireResult {
  reconcile: Reconcile;
  ranChecks: number;
  failures: PostFireFailure[];
}

/**
 * Reconcile a run's bare `completed` claim with an out-of-band re-check.
 * `green = success` is treated as UNVERIFIED until a deterministic check passes:
 * no checks → `unverifiable` (nothing to prove the claim), all pass →
 * `confirmed`, any fail → `false_done`.
 */
export function reconcileOutcome(
  ranChecks: number,
  allPassed: boolean,
): Reconcile {
  if (ranChecks === 0) return "unverifiable";
  return allPassed ? "confirmed" : "false_done";
}

/**
 * Assemble the deterministic post-fire check commands for a run from its
 * acceptance config: `verify_cmds`, a single `verify_cmd`, and any
 * criterion-bound checks (`text :: cmd`). Pure — the caller supplies the raw
 * config values so this is trivially testable.
 */
export function postFireCheckCommands(
  verifyCmds: string[],
  verifyCmd: string,
  criteria: string[],
): string[] {
  const cmds = [...verifyCmds];
  const single = verifyCmd.trim();
  if (single) cmds.push(single);
  for (const line of criteria) {
    const { check } = parseCriterion(line);
    if (check) cmds.push(check);
  }
  return cmds;
}

/**
 * Run the deterministic checks out-of-band in `workDir` (the completed run's
 * work tree) and reconcile. This IS the independent post-fire verifier for
 * detached/scheduled runs: nobody watched the run, so the harness re-checks.
 */
export function verifyPostFire(
  workDir: string,
  cmds: string[],
  timeoutMs: number,
): PostFireResult {
  const failures: PostFireFailure[] = [];
  for (const command of cmds) {
    const res = spawnSync(command, {
      shell: "/bin/sh",
      cwd: workDir,
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
    });
    const timedOut =
      res.signal === "SIGTERM" ||
      (res.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
    const exitCode = timedOut ? 124 : (res.status ?? 1);
    if (exitCode !== 0) {
      failures.push({
        command,
        exitCode,
        tail: `${res.stdout ?? ""}${res.stderr ?? ""}`.slice(-1000),
      });
    }
  }
  return {
    reconcile: reconcileOutcome(cmds.length, failures.length === 0),
    ranChecks: cmds.length,
    failures,
  };
}
