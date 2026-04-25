import { describe, expect, it } from "vitest";
import { checkBudget, defaultBudget } from "../../src/chains/budget.js";

describe("checkBudget", () => {
  it("accepts tracker within defaults", () => {
    const budget = defaultBudget();
    const result = checkBudget(budget, {
      depth: 1,
      totalSteps: 1,
      children: 1,
      consecutiveFailures: 0,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects max steps overflow", () => {
    const budget = defaultBudget();
    const result = checkBudget(budget, {
      depth: 1,
      totalSteps: 50,
      children: 1,
      consecutiveFailures: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("max_steps exceeded");
  });
});
