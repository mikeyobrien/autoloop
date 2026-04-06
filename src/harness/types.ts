import type * as topo from "../topology.js";
import type { KiroSessionHandle } from "../backend/kiro-bridge.js";
import type { AgentMap } from "../agent-map.js";

export type TriggerSource = "cli" | "chain" | "branch";

export interface LaunchMetadata {
  preset: string;
  trigger: TriggerSource;
  createdAt: string;
  parentRunId: string;
}

export interface ProfileInfo {
  active: string[];
  fragments: Map<string, string>;
  warnings: string[];
}

export interface LoopContext {
  objective: string;
  topology: topo.Topology;
  limits: { maxIterations: number };
  completion: { promise: string; event: string; requiredEvents: string[] };
  backend: {
    kind: string;
    command: string;
    args: string[];
    promptMode: string;
    timeoutMs: number;
  };
  review: {
    enabled: boolean;
    every: number;
    kind: string;
    command: string;
    args: string[];
    promptMode: string;
    prompt: string;
    timeoutMs: number;
  };
  parallel: { enabled: boolean; maxBranches: number; branchTimeoutMs: number };
  memory: { budgetChars: number };
  tasks: { budgetChars: number };
  harness: { instructions: string };
  profiles: ProfileInfo;
  paths: {
    projectDir: string;
    workDir: string;
    stateDir: string;
    journalFile: string;
    memoryFile: string;
    tasksFile: string;
    registryFile: string;
    toolPath: string;
    piAdapterPath: string;
    baseStateDir: string;
    mainProjectDir: string;
    worktreeBranch: string;
    worktreePath: string;
    worktreeMetaDir: string;
  };
  runtime: {
    runId: string;
    selfCommand: string;
    promptOverride: string | null;
    backendOverride: Record<string, unknown>;
    logLevel: string;
    branchMode: boolean;
    isolationMode: string;
  };
  launch: LaunchMetadata;
  store: Record<string, unknown>;
  agentMap: AgentMap | null;
  kiroSession?: KiroSessionHandle;
}

export interface RunOptions {
  workDir?: string;
  backendOverride?: Record<string, unknown>;
  logLevel?: string | null;
  prompt?: string | null;
  chain?: string | null;
  trigger?: TriggerSource;
  parentRunId?: string;
  profiles?: string[];
  noDefaultProfiles?: boolean;
  worktree?: boolean;
  noWorktree?: boolean;
  isolationMode?: string;
  mergeStrategy?: string;
  automerge?: boolean;
  keepWorktree?: boolean;
}

export interface RunSummary {
  iterations: number;
  stopReason: string;
  runId?: string;
}
