import type * as topo from "../topology.js";

export type TriggerSource = "cli" | "chain" | "branch";

export interface LaunchMetadata {
  preset: string;
  trigger: TriggerSource;
  createdAt: string;
  parentRunId: string;
}

export interface LoopContext {
  objective: string;
  topology: topo.Topology;
  limits: { maxIterations: number };
  completion: { promise: string; event: string; requiredEvents: string[] };
  backend: { kind: string; command: string; args: string[]; promptMode: string; timeoutMs: number };
  review: { enabled: boolean; every: number; kind: string; command: string; args: string[]; promptMode: string; prompt: string; timeoutMs: number };
  parallel: { enabled: boolean; maxBranches: number; branchTimeoutMs: number };
  memory: { budgetChars: number };
  harness: { instructions: string };
  paths: { projectDir: string; workDir: string; stateDir: string; journalFile: string; memoryFile: string; registryFile: string; toolPath: string; piAdapterPath: string };
  runtime: { runId: string; selfCommand: string; promptOverride: string | null; backendOverride: Record<string, unknown>; logLevel: string; branchMode: boolean };
  launch: LaunchMetadata;
  store: Record<string, unknown>;
}

export interface RunOptions {
  workDir?: string;
  backendOverride?: Record<string, unknown>;
  logLevel?: string | null;
  prompt?: string | null;
  chain?: string | null;
  trigger?: TriggerSource;
  parentRunId?: string;
}

export interface RunSummary {
  iterations: number;
  stopReason: string;
}
