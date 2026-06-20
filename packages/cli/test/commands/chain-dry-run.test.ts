import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Verify `autoloop chain run <name> --dry-run [--json]`: prints the plan
 * without executing anything, and sets process.exitCode = 1 when the plan
 * violates the budget.
 */

// Mock harness so any accidental execution is observable (and side-effect free)
vi.mock("@mobrienv/autoloop-harness", () => ({
  run: vi.fn(() => ({ stopReason: "completion_event", iterations: 1 })),
}));

import * as harness from "@mobrienv/autoloop-harness";
import { dispatchChain } from "../../src/commands/chain.js";

const VALID_TOML = `
[[chain]]
name = "ship"
steps = ["autocode", "autoqa"]

[[chain]]
name = "solo"

[[chain.step]]
preset = "autocode"
backend = { kind = "pi", model = "opus" }
`;

const OVER_BUDGET_TOML = `
[budget]
max_steps = 1

[[chain]]
name = "ship"
steps = ["autocode", "autoqa"]
`;

describe("chain run --dry-run", () => {
  let projectDir: string;
  let logged: string[];
  let savedExitCode: typeof process.exitCode;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "autoloop-chain-dry-"));
    logged = [];
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      logged.push(String(msg));
    });
  });

  afterEach(() => {
    process.exitCode = savedExitCode;
    vi.restoreAllMocks();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("prints a text plan and exits 0 for a valid chain", async () => {
    writeFileSync(join(projectDir, "chains.toml"), VALID_TOML);
    await dispatchChain(["run", "ship", projectDir, "--dry-run"], "autoloop");

    const output = logged.join("\n");
    expect(output).toContain("Chain: ship");
    expect(output).toContain("Steps (2):");
    expect(output).toContain("1. autocode");
    expect(output).toContain("2. autoqa");
    expect(output).toContain("Budget: max_depth=5, max_steps=50");
    expect(output).toContain("Plan: OK");
    expect(process.exitCode).toBeUndefined();
    expect(vi.mocked(harness.run)).not.toHaveBeenCalled();
  });

  it("includes backend overrides in the text plan", async () => {
    writeFileSync(join(projectDir, "chains.toml"), VALID_TOML);
    await dispatchChain(["run", "solo", projectDir, "--dry-run"], "autoloop");

    const output = logged.join("\n");
    expect(output).toContain('backend={"kind":"pi","model":"opus"}');
  });

  it("prints a machine-readable plan with --json", async () => {
    writeFileSync(join(projectDir, "chains.toml"), VALID_TOML);
    await dispatchChain(
      ["run", "ship", projectDir, "--dry-run", "--json"],
      "autoloop",
    );

    expect(logged).toHaveLength(1);
    const plan = JSON.parse(logged[0]);
    expect(plan.chain).toBe("ship");
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].index).toBe(1);
    expect(plan.steps[0].name).toBe("autocode");
    expect(typeof plan.steps[0].presetDir).toBe("string");
    expect(plan.budget.maxSteps).toBe(50);
    expect(plan.validation.ok).toBe(true);
    expect(vi.mocked(harness.run)).not.toHaveBeenCalled();
  });

  it("sets exit code 1 when the plan violates the budget", async () => {
    writeFileSync(join(projectDir, "chains.toml"), OVER_BUDGET_TOML);
    await dispatchChain(["run", "ship", projectDir, "--dry-run"], "autoloop");

    const output = logged.join("\n");
    expect(output).toContain("Plan: INVALID");
    expect(output).toContain("max_steps exceeded (2/1)");
    expect(process.exitCode).toBe(1);
    expect(vi.mocked(harness.run)).not.toHaveBeenCalled();
  });

  it("reports budget violations in --json output", async () => {
    writeFileSync(join(projectDir, "chains.toml"), OVER_BUDGET_TOML);
    await dispatchChain(
      ["run", "ship", projectDir, "--dry-run", "--json"],
      "autoloop",
    );

    const plan = JSON.parse(logged[0]);
    expect(plan.budget.maxSteps).toBe(1);
    expect(plan.validation.ok).toBe(false);
    expect(plan.validation.reason).toContain("max_steps exceeded");
    expect(process.exitCode).toBe(1);
  });

  it("sets exit code 1 when the chain is not found", async () => {
    writeFileSync(join(projectDir, "chains.toml"), VALID_TOML);
    await dispatchChain(["run", "nope", projectDir, "--dry-run"], "autoloop");

    expect(logged.join("\n")).toContain("not found in chains.toml");
    expect(process.exitCode).toBe(1);
  });

  it("does not change exit code for a missing chain without --dry-run", async () => {
    writeFileSync(join(projectDir, "chains.toml"), VALID_TOML);
    await dispatchChain(["run", "nope", projectDir], "autoloop");

    expect(logged.join("\n")).toContain("not found in chains.toml");
    expect(process.exitCode).toBeUndefined();
  });
});
