export interface ChainStep {
  name: string;
  presetDir: string;
}

export interface ChainSpec {
  name: string;
  steps: ChainStep[];
}

export interface Budget {
  maxDepth: number;
  maxSteps: number;
  maxRuntimeMs: number;
  maxChildren: number;
  maxConsecutiveFailures: number;
}

export interface ChainsConfig {
  chains: ChainSpec[];
  budget: Budget;
}

export interface DynamicChainSpec {
  steps: string[];
  justification?: string;
  budget?: Budget;
  chainId?: string;
  parentId?: string;
}

export interface StepRecord {
  step: number;
  name: string;
  stopReason: string;
  runId?: string;
}

export interface ChainTracker {
  depth: number;
  totalSteps: number;
  children: number;
  consecutiveFailures: number;
}
