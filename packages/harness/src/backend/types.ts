import type { LoopContext } from "../types.js";

export interface ResolvedIterationBackend {
  kind: string;
  command: string;
  args: string[];
  promptMode: string;
  timeoutMs: number;
  agent: string;
  model: string;
}

export function resolvedFromLoopBackend(
  loop: LoopContext,
): ResolvedIterationBackend {
  return {
    kind: loop.backend.kind,
    command: loop.backend.command,
    args: [...loop.backend.args],
    promptMode: loop.backend.promptMode,
    timeoutMs: loop.backend.timeoutMs,
    agent: "",
    model: "",
  };
}
