import { describe, expect, it } from "vitest";
import { checkPlanBudget, defaultBudget } from "../../src/chains/budget.js";
import { buildChainPlan, renderChainPlan } from "../../src/chains/dry-run.js";
import type { ChainSpec } from "../../src/chains/types.js";

const spec: ChainSpec = {
  name: "nightly",
  steps: [
    { name: "autocode", presetDir: "/presets/autocode" },
    {
      name: "autoqa",
      presetDir: "/presets/autoqa",
      backendOverride: { kind: "pi", model: "opus" },
    },
  ],
};

describe("checkPlanBudget", () => {
  it("accepts a chain within maxSteps", () => {
    const result = checkPlanBudget(spec, defaultBudget());
    expect(result.ok).toBe(true);
  });

  it("rejects a chain with more steps than maxSteps", () => {
    const result = checkPlanBudget(spec, {
      ...defaultBudget(),
      maxSteps: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("max_steps exceeded (2/1)");
  });
});

describe("buildChainPlan", () => {
  it("builds an ordered plan with resolved preset dirs", () => {
    const plan = buildChainPlan(spec, defaultBudget());
    expect(plan.chain).toBe("nightly");
    expect(plan.steps).toEqual([
      { index: 1, name: "autocode", presetDir: "/presets/autocode" },
      {
        index: 2,
        name: "autoqa",
        presetDir: "/presets/autoqa",
        backendOverride: { kind: "pi", model: "opus" },
      },
    ]);
    expect(plan.budget).toEqual(defaultBudget());
    expect(plan.validation).toEqual({ ok: true });
  });

  it("omits backendOverride for steps without one", () => {
    const plan = buildChainPlan(spec, defaultBudget());
    expect("backendOverride" in plan.steps[0]).toBe(false);
  });

  it("flags budget violations in validation", () => {
    const plan = buildChainPlan(spec, { ...defaultBudget(), maxSteps: 1 });
    expect(plan.validation.ok).toBe(false);
    expect(plan.validation.reason).toContain("max_steps exceeded");
  });
});

describe("renderChainPlan", () => {
  it("renders a valid plan as text", () => {
    const text = renderChainPlan(buildChainPlan(spec, defaultBudget()));
    expect(text).toContain("Chain: nightly");
    expect(text).toContain("Steps (2):");
    expect(text).toContain("1. autocode  /presets/autocode");
    expect(text).toContain("2. autoqa  /presets/autoqa");
    expect(text).toContain('backend={"kind":"pi","model":"opus"}');
    expect(text).toContain(
      "Budget: max_depth=5, max_steps=50, max_runtime_ms=3600000, " +
        "max_children=10, max_consecutive_failures=3",
    );
    expect(text).toContain("Plan: OK");
  });

  it("renders an invalid plan with the violation reason", () => {
    const text = renderChainPlan(
      buildChainPlan(spec, { ...defaultBudget(), maxSteps: 1 }),
    );
    expect(text).toContain("Plan: INVALID");
    expect(text).toContain("max_steps exceeded (2/1)");
    expect(text).not.toContain("Plan: OK");
  });
});
