import { checkPlanBudget } from "./budget.js";
import type { Budget, ChainPlan, ChainSpec } from "./types.js";

/**
 * Build the execution plan for a chain without running anything: ordered
 * steps with resolved preset dirs and backend overrides, the budget that
 * would apply, and a static budget validation result.
 */
export function buildChainPlan(spec: ChainSpec, budget: Budget): ChainPlan {
  return {
    chain: spec.name,
    steps: spec.steps.map((step, idx) => ({
      index: idx + 1,
      name: step.name,
      presetDir: step.presetDir,
      ...(step.backendOverride !== undefined
        ? { backendOverride: step.backendOverride }
        : {}),
    })),
    budget,
    validation: checkPlanBudget(spec, budget),
  };
}

export function renderChainPlan(plan: ChainPlan): string {
  let out = `Chain: ${plan.chain}\n`;
  out += `Steps (${plan.steps.length}):\n`;
  for (const step of plan.steps) {
    out += `  ${step.index}. ${step.name}  ${step.presetDir}`;
    if (step.backendOverride !== undefined) {
      out += `  backend=${JSON.stringify(step.backendOverride)}`;
    }
    out += "\n";
  }
  const b = plan.budget;
  out +=
    "Budget: " +
    `max_depth=${b.maxDepth}, ` +
    `max_steps=${b.maxSteps}, ` +
    `max_runtime_ms=${b.maxRuntimeMs}, ` +
    `max_children=${b.maxChildren}, ` +
    `max_consecutive_failures=${b.maxConsecutiveFailures}\n`;
  out += plan.validation.ok
    ? "Plan: OK"
    : `Plan: INVALID — ${plan.validation.reason}`;
  return out;
}
