import type { BranchResult, FanoutStage } from "@mobrienv/autoloop-core/fanout";
import {
  type BranchSpec,
  expandStageBranches,
  runFanoutStage,
} from "@mobrienv/autoloop-harness/fanout-runner";
import { describe, expect, it } from "vitest";

function stage(overrides: Partial<FanoutStage>): FanoutStage {
  return {
    id: "verify",
    kind: "verdict",
    branches: 3,
    role: "verifier",
    roles: [],
    join: "majority-vote",
    requires: [],
    voteField: "affirm",
    voteThreshold: "majority",
    itemsField: "findings",
    keyField: "key",
    countMin: 1,
    quorum: 0,
    onPass: "verify.passed",
    onFail: "verify.blocked",
    synthesizerRole: "",
    ...overrides,
  };
}

describe("expandStageBranches", () => {
  it("expands a K-identical panel into N copies of the role", () => {
    const specs = expandStageBranches(stage({ branches: 3, role: "verifier" }));
    expect(specs).toHaveLength(3);
    expect(specs.every((s) => s.role === "verifier")).toBe(true);
    expect(specs.map((s) => s.branchId)).toEqual([
      "verify.0",
      "verify.1",
      "verify.2",
    ]);
  });

  it("expands an N-distinct panel into one branch per sub-role", () => {
    const specs = expandStageBranches(
      stage({
        branches: 0,
        role: "",
        roles: ["correctness", "security", "repro"],
      }),
    );
    expect(specs.map((s) => s.role)).toEqual([
      "correctness",
      "security",
      "repro",
    ]);
  });
});

describe("runFanoutStage", () => {
  function affirm(spec: BranchSpec, value: boolean): BranchResult {
    return { branchId: spec.branchId, ok: true, data: { affirm: value } };
  }

  it("runs a judge panel and routes to onPass on a majority", async () => {
    const out = await runFanoutStage(
      stage({ branches: 3 }),
      async (spec) => affirm(spec, spec.index !== 2), // 2 of 3 affirm
      4,
    );
    expect(out.passed).toBe(true);
    expect(out.event).toBe("verify.passed");
    expect(out.tally?.affirm).toBe(2);
  });

  it("isolates a thrown branch as a dead branch (one failure does not sink the wave)", async () => {
    const out = await runFanoutStage(
      stage({ branches: 3 }),
      async (spec) => {
        if (spec.index === 0) throw new Error("branch crashed");
        return affirm(spec, true);
      },
      4,
    );
    // 2 survivors, both affirm; verdict quorum(3)=2 met -> pass
    expect(out.passed).toBe(true);
    expect(out.tally?.surviving).toBe(2);
  });

  it("fails to onFail when too many branches die (quorum)", async () => {
    const out = await runFanoutStage(
      stage({ branches: 3 }),
      async (spec) => {
        if (spec.index === 0) return affirm(spec, true);
        throw new Error("dead");
      },
      4,
    );
    // 1 survivor of 3 < majority(3)=2 -> quorum fail
    expect(out.passed).toBe(false);
    expect(out.event).toBe("verify.blocked");
    expect(out.reason).toContain("quorum");
  });

  it("respects the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    await runFanoutStage(
      stage({ branches: 6 }),
      async (spec) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return affirm(spec, true);
      },
      2,
    );
    expect(peak).toBe(2);
  });
});
