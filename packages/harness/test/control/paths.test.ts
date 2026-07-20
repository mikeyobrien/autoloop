import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { baseStateDirFromRunState } from "../../src/control/paths.js";

describe("baseStateDirFromRunState", () => {
  it("peels runs/<id> for run-scoped/shared state dirs (default root)", () => {
    const base = join("/proj", ".autoloop");
    const runScoped = join(base, "runs", "run-1");
    expect(baseStateDirFromRunState(runScoped)).toBe(base);
  });

  it("peels runs/<id> for a nested custom state root", () => {
    const base = join("/proj", ".ralph", "autoloop");
    const runScoped = join(base, "runs", "run-1");
    expect(baseStateDirFromRunState(runScoped)).toBe(base);
  });

  it("treats a worktree state dir as its own base (default root)", () => {
    const worktreeBase = join("/wt", ".autoloop");
    expect(baseStateDirFromRunState(worktreeBase)).toBe(worktreeBase);
  });

  it("treats a nested worktree state dir as its own base", () => {
    // basename here is "autoloop" (not ".autoloop"); the old leaf-name check
    // would misfire and peel two levels. Parent-is-"runs" logic is correct.
    const worktreeBase = join("/wt", ".ralph", "autoloop");
    expect(baseStateDirFromRunState(worktreeBase)).toBe(worktreeBase);
  });
});
