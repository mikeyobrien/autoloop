import type { LoopContext } from "../types.js";

export interface ResolvedIterationBackend {
  kind: string;
  provider: string;
  command: string;
  args: string[];
  promptMode: string;
  timeoutMs: number;
  trustAllTools: boolean;
  agent: string;
  model: string;
  disallowedTools: string[];
}

export function resolvedFromLoopBackend(
  loop: LoopContext,
): ResolvedIterationBackend {
  return {
    kind: loop.backend.kind,
    provider: loop.backend.provider,
    command: loop.backend.command,
    args: [...loop.backend.args],
    promptMode: loop.backend.promptMode,
    timeoutMs: loop.backend.timeoutMs,
    trustAllTools: loop.backend.trustAllTools,
    agent: loop.backend.agent,
    model: loop.backend.model,
    disallowedTools: [...(loop.backend.disallowedTools ?? [])],
  };
}
