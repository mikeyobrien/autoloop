import { describe, expect, it } from "vitest";
import {
  applySchema,
  type BranchResult,
  concatItems,
  countThreshold,
  dedupByKey,
  type FanoutStage,
  meetsQuorum,
  quorumFloor,
  reduceStage,
  survivors,
  tallyVote,
  validateBranchData,
} from "../src/fanout.js";

function stage(overrides: Partial<FanoutStage>): FanoutStage {
  return {
    id: "s",
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

function ok(branchId: string, data: Record<string, unknown>): BranchResult {
  return { branchId, ok: true, data };
}
function dead(branchId: string): BranchResult {
  return { branchId, ok: false, error: "boom" };
}

describe("survivors", () => {
  it("excludes dead branches and ok-without-data", () => {
    const results = [ok("a", { x: 1 }), dead("b"), { branchId: "c", ok: true }];
    expect(survivors(results).map((r) => r.branchId)).toEqual(["a"]);
  });
});

describe("validateBranchData / applySchema", () => {
  const schema = { requires: ["affirm", "reason"] };

  it("passes when all required keys are present and non-empty", () => {
    expect(
      validateBranchData({ affirm: true, reason: "looks right" }, schema),
    ).toEqual({ ok: true, missing: [] });
  });

  it("flags missing and empty keys", () => {
    expect(validateBranchData({ affirm: true, reason: "  " }, schema)).toEqual({
      ok: false,
      missing: ["reason"],
    });
    expect(validateBranchData(undefined, schema)).toEqual({
      ok: false,
      missing: ["affirm", "reason"],
    });
  });

  it("re-tags schema-invalid branches as dead so reducers skip them", () => {
    const results = [
      ok("a", { affirm: true, reason: "ok" }),
      ok("b", { affirm: true }), // missing reason
    ];
    const checked = applySchema(results, schema);
    expect(checked[0].ok).toBe(true);
    expect(checked[1].ok).toBe(false);
    expect(checked[1].error).toContain("reason");
  });
});

describe("quorum", () => {
  it("verdict default is a majority of launched branches; discovery default is 1", () => {
    expect(quorumFloor("verdict", 5)).toBe(3);
    expect(quorumFloor("verdict", 4)).toBe(2);
    expect(quorumFloor("discovery", 5)).toBe(1);
  });

  it("honors a positive override", () => {
    expect(quorumFloor("discovery", 5, 3)).toBe(3);
  });

  it("a 5-way verdict panel with 3 dead branches fails quorum", () => {
    const results = [
      ok("a", { affirm: true }),
      ok("b", { affirm: false }),
      dead("c"),
      dead("d"),
      dead("e"),
    ];
    expect(meetsQuorum(results, "verdict")).toBe(false); // 2 survivors < 3
    expect(meetsQuorum(results, "discovery")).toBe(true); // 2 >= 1
  });

  it("an empty / all-dead wave never passes quorum (no vacuous pass)", () => {
    expect(meetsQuorum([], "discovery")).toBe(false);
    expect(meetsQuorum([], "verdict")).toBe(false);
    expect(meetsQuorum([dead("a"), dead("b")], "discovery")).toBe(false);
    expect(quorumFloor("discovery", 0)).toBe(1);
  });
});

describe("vote rule — majority with rejection bias", () => {
  const spec = { field: "affirm", threshold: "majority" as const };

  it("strict majority confirms", () => {
    const results = [
      ok("a", { affirm: true }),
      ok("b", { affirm: true }),
      ok("c", { affirm: false }),
    ];
    expect(tallyVote(results, spec)).toEqual({
      affirm: 2,
      surviving: 3,
      passed: true,
    });
  });

  it("a tie rejects (rejection bias)", () => {
    const results = [ok("a", { affirm: true }), ok("b", { affirm: false })];
    expect(tallyVote(results, spec).passed).toBe(false);
  });

  it("missing / non-boolean / uncertain fields count as rejection", () => {
    const results = [
      ok("a", { affirm: true }),
      ok("b", {}), // missing -> reject
      ok("c", { affirm: "yes" }), // non-boolean -> reject
    ];
    expect(tallyVote(results, spec).affirm).toBe(1);
    expect(tallyVote(results, spec).passed).toBe(false);
  });

  it("dead branches are excluded from the tally", () => {
    const results = [ok("a", { affirm: true }), dead("b"), dead("c")];
    expect(tallyVote(results, spec)).toEqual({
      affirm: 1,
      surviving: 1,
      passed: true, // 1 of 1 surviving
    });
  });

  it("supermajority needs >= two-thirds", () => {
    const spec2 = { field: "affirm", threshold: "supermajority" as const };
    const twoOfThree = [
      ok("a", { affirm: true }),
      ok("b", { affirm: true }),
      ok("c", { affirm: false }),
    ];
    expect(tallyVote(twoOfThree, spec2).passed).toBe(true);
    const threeOfFive = [
      ok("a", { affirm: true }),
      ok("b", { affirm: true }),
      ok("c", { affirm: true }),
      ok("d", { affirm: false }),
      ok("e", { affirm: false }),
    ];
    expect(tallyVote(threeOfFive, spec2).passed).toBe(false); // 3/5 < 2/3
  });

  it("unanimous needs every survivor", () => {
    const spec3 = { field: "affirm", threshold: "unanimous" as const };
    expect(
      tallyVote([ok("a", { affirm: true }), ok("b", { affirm: true })], spec3)
        .passed,
    ).toBe(true);
    expect(
      tallyVote([ok("a", { affirm: true }), ok("b", { affirm: false })], spec3)
        .passed,
    ).toBe(false);
  });
});

describe("item reducers — discovery / finder pools", () => {
  const r = [
    ok("a", { findings: [{ key: "F1" }, { key: "F2" }] }),
    ok("b", { findings: [{ key: "F2" }, { key: "F3" }] }),
    dead("c"),
  ];

  it("concatItems flattens surviving branches' arrays", () => {
    expect(concatItems(r, "findings").map((f) => f.key)).toEqual([
      "F1",
      "F2",
      "F2",
      "F3",
    ]);
  });

  it("dedupByKey keeps first occurrence per key", () => {
    expect(dedupByKey(r, "findings", "key").map((f) => f.key)).toEqual([
      "F1",
      "F2",
      "F3",
    ]);
  });

  it("dedupByKey keeps keyless items as distinct", () => {
    const r2 = [ok("a", { findings: [{ note: "x" }, { note: "y" }] })];
    expect(dedupByKey(r2, "findings", "key")).toHaveLength(2);
  });

  it("dedupByKey does not collapse values that stringify alike (1 vs '1')", () => {
    const r2 = [
      ok("a", {
        findings: [{ key: 1 }, { key: "1" }, { key: true }, { key: "true" }],
      }),
    ];
    // All four are distinct keys despite identical String() forms.
    expect(dedupByKey(r2, "findings", "key")).toHaveLength(4);
  });

  it("countThreshold counts deduped items", () => {
    expect(countThreshold(r, "findings", "key", 3)).toBe(true);
    expect(countThreshold(r, "findings", "key", 4)).toBe(false);
  });
});

describe("reduceStage — stage spec to routing decision", () => {
  function ok(id: string, data: Record<string, unknown>): BranchResult {
    return { branchId: id, ok: true, data };
  }
  function dead(id: string): BranchResult {
    return { branchId: id, ok: false, error: "x" };
  }

  it("majority-vote verdict routes to onPass when majority affirms", () => {
    const out = reduceStage(stage({ join: "majority-vote" }), [
      ok("a", { affirm: true }),
      ok("b", { affirm: true }),
      ok("c", { affirm: false }),
    ]);
    expect(out.passed).toBe(true);
    expect(out.event).toBe("verify.passed");
    expect(out.tally?.affirm).toBe(2);
  });

  it("majority-vote routes to onFail on a tie (rejection bias)", () => {
    const out = reduceStage(stage({ join: "majority-vote" }), [
      ok("a", { affirm: true }),
      ok("b", { affirm: false }),
    ]);
    expect(out.passed).toBe(false);
    expect(out.event).toBe("verify.blocked");
  });

  it("fails to onFail when quorum is not met (verdict)", () => {
    const out = reduceStage(stage({ join: "majority-vote", branches: 5 }), [
      ok("a", { affirm: true }),
      dead("b"),
      dead("c"),
      dead("d"),
      dead("e"),
    ]);
    // 1 survivor of 5 launched < majority(5)=3 -> quorum fail
    expect(out.passed).toBe(false);
    expect(out.event).toBe("verify.blocked");
    expect(out.reason).toContain("quorum");
  });

  it("schema-invalid branches are dropped before the vote", () => {
    const out = reduceStage(
      stage({ join: "majority-vote", requires: ["affirm"], branches: 2 }),
      [ok("a", { affirm: true }), ok("b", {})], // b missing affirm -> dead
    );
    // only 'a' survives; verdict quorum(2)=1 met; 1/1 affirm -> pass
    expect(out.passed).toBe(true);
    expect(out.tally?.surviving).toBe(1);
  });

  it("count-threshold discovery routes on deduped item count", () => {
    const s = stage({
      kind: "discovery",
      join: "count-threshold",
      itemsField: "findings",
      keyField: "key",
      countMin: 3,
      onPass: "enough.found",
      onFail: "too.few",
    });
    const results = [
      ok("a", { findings: [{ key: "F1" }, { key: "F2" }] }),
      ok("b", { findings: [{ key: "F2" }, { key: "F3" }] }),
    ];
    expect(reduceStage(s, results).event).toBe("enough.found");
    expect(reduceStage({ ...s, countMin: 4 }, results).event).toBe("too.few");
  });

  it("dedup-by-key passes through with deduped items", () => {
    const s = stage({
      kind: "discovery",
      join: "dedup-by-key",
      itemsField: "findings",
      keyField: "key",
      onPass: "found",
    });
    const out = reduceStage(s, [
      ok("a", { findings: [{ key: "F1" }, { key: "F1" }] }),
    ]);
    expect(out.passed).toBe(true);
    expect(out.items).toHaveLength(1);
  });

  it("synthesize defers to a synthesizer role, passing items through", () => {
    const s = stage({
      kind: "discovery",
      join: "synthesize",
      itemsField: "findings",
      synthesizerRole: "synth",
      onPass: "synth.ready",
    });
    const out = reduceStage(s, [ok("a", { findings: [{ key: "F1" }] })]);
    expect(out.passed).toBe(true);
    expect(out.event).toBe("synth.ready");
    expect(out.reason).toContain("synthesizer");
  });
});
