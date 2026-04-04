import type { Budget, ChainTracker } from "./types.js";

export function defaultBudget(): Budget {
  return {
    maxDepth: 5,
    maxSteps: 50,
    maxRuntimeMs: 3600000,
    maxChildren: 10,
    maxConsecutiveFailures: 3,
  };
}

export function checkBudget(
  budget: Budget,
  tracker: ChainTracker,
): { ok: boolean; reason?: string } {
  if (tracker.depth >= budget.maxDepth) {
    return { ok: false, reason: `max_depth exceeded (${tracker.depth}/${budget.maxDepth})` };
  }
  if (tracker.totalSteps >= budget.maxSteps) {
    return { ok: false, reason: `max_steps exceeded (${tracker.totalSteps}/${budget.maxSteps})` };
  }
  if (tracker.children >= budget.maxChildren) {
    return { ok: false, reason: `max_children exceeded (${tracker.children}/${budget.maxChildren})` };
  }
  if (tracker.consecutiveFailures >= budget.maxConsecutiveFailures) {
    return { ok: false, reason: `max_consecutive_failures exceeded (${tracker.consecutiveFailures}/${budget.maxConsecutiveFailures})` };
  }
  return { ok: true };
}

export function parseBudgetFromToml(raw: unknown): Budget {
  const budget = defaultBudget();
  if (typeof raw !== "object" || raw === null) return budget;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.max_depth === "number") budget.maxDepth = obj.max_depth;
  if (typeof obj.max_steps === "number") budget.maxSteps = obj.max_steps;
  if (typeof obj.max_runtime_ms === "number") budget.maxRuntimeMs = obj.max_runtime_ms;
  if (typeof obj.max_children === "number") budget.maxChildren = obj.max_children;
  if (typeof obj.max_consecutive_failures === "number") budget.maxConsecutiveFailures = obj.max_consecutive_failures;
  return budget;
}
