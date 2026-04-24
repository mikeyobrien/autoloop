import type { LoopContext } from "../types.js";

export interface BackendSpec {
  kind: string;
  command: string;
  args: string[];
  promptMode: string;
  timeoutMs: number;
}

export interface BackendRunResult {
  output: string;
  exitCode: number;
  timedOut: boolean;
  providerKind: string;
  errorCategory: "none" | "timeout" | "non_zero_exit";
}

export interface BackendCommandContext {
  loop: LoopContext;
  spec: Pick<BackendSpec, "kind" | "command" | "args" | "promptMode">;
  prompt: string;
  runtimeEnv: string;
}
