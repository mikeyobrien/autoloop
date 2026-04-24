import type { RunSummary } from "../types.js";

export interface WaveResult {
  reason: string;
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

export type IterateFn = (loop: any, iteration: number) => RunSummary;
