import type { RunSummary } from "../types.js";

/** Wave completion strategy, mirroring `LoopContext["parallel"]["aggregate"]`. */
export interface AggregateConfig {
  mode: "wait_for_all" | "first_success" | "timeout";
  timeoutMs: number;
}

/**
 * How this wave was triggered — an agent-emitted `.parallel` topic, or the
 * harness auto-launching a role's declarative `concurrency`. Surfaced in
 * `wave.start`/`wave.invalid`/`wave.join.start` journal metadata.
 */
export type WaveSource = "agent" | "declarative";

export interface WaveResult {
  reason: string;
  waveId: string;
  elapsedMs: number;
  source?: WaveSource;
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

/** Outcome of joining a wave under a given aggregate mode. */
export interface AggregateOutcome {
  mode: "wait_for_all" | "first_success" | "timeout";
  /** For `first_success`: the branch id whose success resolved the wave. */
  satisfiedByBranchId?: string;
  /** For `timeout`: whether the wall-clock deadline was hit. */
  aggregateTimedOut: boolean;
}

export interface ParseResult {
  ok: boolean;
  objectives: string[];
  reason: string;
}

export type IterateFn = (loop: any, iteration: number) => Promise<RunSummary>;
