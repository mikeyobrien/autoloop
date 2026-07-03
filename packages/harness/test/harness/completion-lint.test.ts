import {
  type CompletionContractInput,
  hasDeterministicCheck,
  lintCompletionContract,
} from "@mobrienv/autoloop-harness/completion-lint";
import { describe, expect, it } from "vitest";

function contract(
  over: Partial<CompletionContractInput>,
): CompletionContractInput {
  return {
    promise: "LOOP_COMPLETE",
    event: "task.complete",
    requiredEvents: [],
    verifyCmds: [],
    criteria: [],
    ...over,
  };
}

describe("hasDeterministicCheck", () => {
  it("is true with verify_cmds", () => {
    expect(hasDeterministicCheck(contract({ verifyCmds: ["npm test"] }))).toBe(
      true,
    );
  });
  it("is true with required events", () => {
    expect(
      hasDeterministicCheck(contract({ requiredEvents: ["verify.done"] })),
    ).toBe(true);
  });
  it("is true with a criterion-bound check", () => {
    expect(
      hasDeterministicCheck(contract({ criteria: ["works :: true"] })),
    ).toBe(true);
  });
  it("is false with none of the above", () => {
    expect(hasDeterministicCheck(contract({}))).toBe(false);
  });
});

describe("lintCompletionContract", () => {
  it("warns on an un-falsifiable completion (no deterministic check)", () => {
    const findings = lintCompletionContract(contract({}));
    expect(findings.map((f) => f.rule)).toContain("unfalsifiable_completion");
  });

  it("warns on a trivial promise when nothing else gates completion", () => {
    const findings = lintCompletionContract(contract({ promise: "done" }));
    expect(findings.map((f) => f.rule)).toContain("trivial_promise");
  });

  it("does not warn trivial_promise when a deterministic check backs it", () => {
    const findings = lintCompletionContract(
      contract({ promise: "done", verifyCmds: ["npm test"] }),
    );
    expect(findings.map((f) => f.rule)).not.toContain("trivial_promise");
    expect(findings.map((f) => f.rule)).not.toContain(
      "unfalsifiable_completion",
    );
  });

  it("passes a well-formed contract (verify_cmds) with no warnings", () => {
    const findings = lintCompletionContract(
      contract({ verifyCmds: ["npm test"] }),
    );
    expect(findings.filter((f) => f.level === "warn")).toHaveLength(0);
  });

  it("passes a contract gated by required events", () => {
    const findings = lintCompletionContract(
      contract({ requiredEvents: ["verify.done"] }),
    );
    expect(findings.filter((f) => f.level === "warn")).toHaveLength(0);
  });

  it("infos when criteria are advisory-only (no bound checks)", () => {
    const findings = lintCompletionContract(
      contract({ verifyCmds: ["npm test"], criteria: ["looks nice"] }),
    );
    expect(findings.map((f) => f.rule)).toContain("advisory_criteria_only");
    expect(
      findings.find((f) => f.rule === "advisory_criteria_only")?.level,
    ).toBe("info");
  });
});
