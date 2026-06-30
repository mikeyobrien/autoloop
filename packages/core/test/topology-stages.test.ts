import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTopologyFromFile, validateTopology } from "../src/topology.js";

function topoFrom(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-stages-"));
  const file = join(dir, "p.toml");
  writeFileSync(file, body);
  return loadTopologyFromFile(file);
}

describe("fan-out stage parsing", () => {
  it("parses a verdict judge-panel stage with defaults", () => {
    const topo = topoFrom(`
name = "p"
completion = "task.complete"

[[role]]
id = "verifier"
prompt = "verify"
emits = ["verify.passed", "verify.blocked"]

[handoff]
"loop.start" = ["verifier"]
"verify.passed" = ["verifier"]
"verify.blocked" = ["verifier"]

[[stage]]
id = "verify"
kind = "verdict"
branches = 3
role = "verifier"
join = "majority-vote"
requires = ["affirm", "reason"]
vote_field = "affirm"
vote_threshold = "supermajority"
on_pass = "verify.passed"
on_fail = "verify.blocked"
`);
    expect(topo.stages).toHaveLength(1);
    const s = topo.stages[0];
    expect(s.id).toBe("verify");
    expect(s.kind).toBe("verdict");
    expect(s.branches).toBe(3);
    expect(s.role).toBe("verifier");
    expect(s.join).toBe("majority-vote");
    expect(s.requires).toEqual(["affirm", "reason"]);
    expect(s.voteThreshold).toBe("supermajority");
    expect(s.onPass).toBe("verify.passed");
  });

  it("defaults kind to discovery, join to concat, and derives on_pass/on_fail", () => {
    const topo = topoFrom(`
name = "p"
[[role]]
id = "finder"
prompt = "find"
emits = ["find.done"]
[handoff]
"loop.start" = ["finder"]

[[stage]]
id = "find"
roles = ["finder"]
`);
    const s = topo.stages[0];
    expect(s.kind).toBe("discovery");
    expect(s.join).toBe("concat");
    expect(s.onPass).toBe("find.passed");
    expect(s.onFail).toBe("find.blocked");
    expect(s.roles).toEqual(["finder"]);
  });
});

describe("validateTopology — fan-out stage checks", () => {
  it("flags a stage referencing an unknown role", () => {
    const topo = topoFrom(`
name = "p"
completion = "task.complete"
[[role]]
id = "real"
prompt = "x"
emits = ["task.complete"]
[handoff]
"loop.start" = ["real"]

[[stage]]
id = "s"
role = "ghost"
branches = 2
on_pass = "task.complete"
on_fail = "task.complete"
`);
    const w = validateTopology(topo);
    expect(
      w.some(
        (x) => x.kind === "stage-unknown-role" && x.message.includes("ghost"),
      ),
    ).toBe(true);
  });

  it("flags an unroutable stage outcome event", () => {
    const topo = topoFrom(`
name = "p"
completion = "task.complete"
[[role]]
id = "v"
prompt = "x"
emits = ["task.complete"]
[handoff]
"loop.start" = ["v"]

[[stage]]
id = "s"
role = "v"
branches = 2
on_pass = "nowhere.event"
on_fail = "task.complete"
`);
    const w = validateTopology(topo);
    expect(
      w.some(
        (x) =>
          x.kind === "stage-event-unroutable" &&
          x.message.includes("nowhere.event"),
      ),
    ).toBe(true);
  });

  it("flags a stage that launches no branches", () => {
    const topo = topoFrom(`
name = "p"
completion = "task.complete"
[[role]]
id = "v"
prompt = "x"
emits = ["task.complete"]
[handoff]
"loop.start" = ["v"]

[[stage]]
id = "s"
on_pass = "task.complete"
on_fail = "task.complete"
`);
    const w = validateTopology(topo);
    expect(w.some((x) => x.kind === "stage-empty")).toBe(true);
  });

  it("flags schema incoherence when the vote field is not required", () => {
    const topo = topoFrom(`
name = "p"
completion = "task.complete"
[[role]]
id = "v"
prompt = "x"
emits = ["task.complete"]
[handoff]
"loop.start" = ["v"]

[[stage]]
id = "s"
role = "v"
branches = 3
join = "majority-vote"
requires = ["reason"]
vote_field = "affirm"
on_pass = "task.complete"
on_fail = "task.complete"
`);
    const w = validateTopology(topo);
    expect(
      w.some(
        (x) =>
          x.kind === "stage-schema-incoherent" && x.message.includes("affirm"),
      ),
    ).toBe(true);
  });

  it("flags defined-but-inert stages on the single-file (runnable) path", () => {
    const topo = topoFrom(`
name = "p"
completion = "task.complete"
[[role]]
id = "v"
prompt = "x"
emits = ["task.complete"]
[handoff]
"loop.start" = ["v"]

[[stage]]
id = "s"
role = "v"
branches = 2
on_pass = "task.complete"
on_fail = "task.complete"
`);
    // Default (directory) validation does not flag execution-readiness...
    expect(
      validateTopology(topo).some((w) => w.kind === "stage-not-executed"),
    ).toBe(false);
    // ...but single-file (the runnable auto-chain path) refuses inert stages.
    expect(
      validateTopology(topo, { singleFile: true }).some(
        (w) => w.kind === "stage-not-executed",
      ),
    ).toBe(true);
  });

  it("a well-formed stage produces no stage warnings", () => {
    const topo = topoFrom(`
name = "p"
completion = "task.complete"
[[role]]
id = "verifier"
prompt = "x"
emits = ["verify.passed", "verify.blocked"]
[[role]]
id = "done"
prompt = "x"
emits = ["task.complete"]
[handoff]
"loop.start" = ["verifier"]
"verify.passed" = ["done"]
"verify.blocked" = ["verifier"]

[[stage]]
id = "verify"
kind = "verdict"
role = "verifier"
branches = 3
join = "majority-vote"
requires = ["affirm"]
vote_field = "affirm"
on_pass = "verify.passed"
on_fail = "verify.blocked"
`);
    const stageWarnings = validateTopology(topo).filter((w) =>
      w.kind.startsWith("stage-"),
    );
    expect(stageWarnings).toEqual([]);
  });
});
