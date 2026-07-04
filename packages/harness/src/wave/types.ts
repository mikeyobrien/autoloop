import type { RunSummary, StopReason } from "../types.js";

/**
 * Non-terminal wave-join decision. `"parallel_wave_complete"` is
 * intentionally NOT part of `StopReason`: it only ever triggers
 * `continueAfterParallelJoin` (the loop keeps running) and never becomes a
 * `RunSummary.stopReason`. The other two literals are terminal and flow
 * into `RunSummary` via `stopAfterParallelWave`. See `wave/finalize-wave.ts`.
 */
export type WaveJoinReason =
  | Extract<
      StopReason,
      "parallel_wave_timeout" | "parallel_wave_failed" | "parallel_wave_invalid"
    >
  | "parallel_wave_complete";

export interface WaveResult {
  reason: WaveJoinReason;
  waveId: string;
  elapsedMs: number;
}

export interface BranchSpec {
  branchId: string;
  waveId: string;
  objective: string;
  emittedTopic: string;
  routingEvent: string;
  allowedRoles: string[];
  allowedEvents: string[];
  prompt: string;
  branchDir: string;
  launchFile: string;
  summaryFile: string;
  stdoutFile: string;
  stderrFile: string;
  statusFile: string;
  pidFile: string;
  supervisorFile: string;
  launchMs: number;
}

/**
 * `stopReason` is intentionally `string`, not `StopReason` (from
 * `../types.js`): it's parsed from a subprocess's stdout
 * (`extractField(line, "stop_reason")` in `wave/launch-branches.ts`) and
 * includes a synthetic fallback value, `"branch_process_failed"`, that is
 * outside the 23-value `StopReason` domain. Naively retyping this would
 * require either an unsafe cast or runtime validation of untrusted process
 * output — out of scope for the `StopReason` contract, which only governs
 * `RunSummary.stopReason`.
 */
export interface BranchResult {
  branchId: string;
  objective: string;
  stopReason: string;
  output: string;
  routingEvent: string;
  allowedRoles: string[];
  allowedEvents: string[];
  branchDir: string;
  elapsedMs: number;
  finishedAtMs: number;
}

export interface ParseResult {
  ok: boolean;
  objectives: string[];
  reason: string;
}

export type IterateFn = (loop: any, iteration: number) => Promise<RunSummary>;
