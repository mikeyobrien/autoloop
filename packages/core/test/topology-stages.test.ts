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
emits = ["verify.panel", "verify.passed", "verify.blocked"]

[handoff]
"loop.start" = ["verifier"]
"verify.panel" = []
"verify.passed" = ["verifier"]
"verify.blocked" = ["verifier"]

[[stage]]
id = "verify"
kind = "verdict"
trigger = "verify.panel"
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
    expect(s.trigger).toBe("verify.panel");
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
trigger = "find.done"
roles = ["finder"]
`);
    const s = topo.stages[0];
    expect(s.kind).toBe("discovery");
    expect(s.join).toBe("concat");
    expect(s.onPass).toBe("find.passed");
    expect(s.onFail).toBe("find.blocked");
    expect(s.roles).toEqual(["finder"]);
  });

  it("parses trigger from the `on` alias", () => {
    const topo = topoFrom(`
name = "p"
[[role]]
id = "finder"
prompt = "find"
emits = ["find.go"]
[handoff]
"loop.start" = ["finder"]

[[stage]]
id = "find"
on = "find.go"
roles = ["finder"]
`);
    expect(topo.stages[0].trigger).toBe("find.go");
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
emits = ["s.trigger", "task.complete"]
[handoff]
"loop.start" = ["real"]
"s.trigger" = []

[[stage]]
id = "s"
trigger = "s.trigger"
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
emits = ["s.trigger", "task.complete"]
[handoff]
"loop.start" = ["v"]
"s.trigger" = []

[[stage]]
id = "s"
trigger = "s.trigger"
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
emits = ["s.trigger", "task.complete"]
[handoff]
"loop.start" = ["v"]
"s.trigger" = []

[[stage]]
id = "s"
trigger = "s.trigger"
on_pass = "task.complete"
on_fail = "task.complete"
`);
    const w = validateTopology(topo);
    expect(w.some((x) => x.kind === "stage-empty")).toBe(true);
  });

  it("flags a stage with no trigger", () => {
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
    const w = validateTopology(topo);
    expect(w.some((x) => x.kind === "stage-trigger-missing")).toBe(true);
  });

  it("flags a stage whose trigger is never emitted", () => {
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
trigger = "ghost.trigger"
role = "v"
branches = 2
on_pass = "task.complete"
on_fail = "task.complete"
`);
    const w = validateTopology(topo);
    expect(
      w.some(
        (x) =>
          x.kind === "stage-trigger-dead" &&
          x.message.includes("ghost.trigger"),
      ),
    ).toBe(true);
  });

  it("flags schema incoherence when the vote field is not required", () => {
    const topo = topoFrom(`
name = "p"
completion = "task.complete"
[[role]]
id = "v"
prompt = "x"
emits = ["s.trigger", "task.complete"]
[handoff]
"loop.start" = ["v"]
"s.trigger" = []

[[stage]]
id = "s"
trigger = "s.trigger"
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

  it("a well-formed single-file stage produces ZERO warnings of any kind", () => {
    const topo = topoFrom(`
name = "p"
completion = "task.complete"
[[role]]
id = "verifier"
prompt = "x"
emits = ["verify.panel", "verify.passed", "verify.blocked"]
[[role]]
id = "done"
prompt = "x"
emits = ["task.complete"]
[handoff]
"loop.start" = ["verifier"]
"verify.panel" = []
"verify.passed" = ["done"]
"verify.blocked" = ["verifier"]

[[stage]]
id = "verify"
kind = "verdict"
trigger = "verify.panel"
role = "verifier"
branches = 3
join = "majority-vote"
requires = ["affirm"]
vote_field = "affirm"
on_pass = "verify.passed"
on_fail = "verify.blocked"
`);
    // Assert the FULL warning set is empty — not just stage-* warnings — because
    // the auto-chain refuses any preset with a non-empty `warnings` array.
    expect(validateTopology(topo, { singleFile: true })).toEqual([]);
  });

  it("does not flag a dedicated branch role as orphaned (reached via the stage)", () => {
    // `verifier` is referenced ONLY as a stage branch role — it is never a
    // handoff-value target. Before the stage-aware orphan check it tripped a
    // false `orphan-role` warning, which made the auto-chain reject every
    // stage-based generated preset.
    const topo = topoFrom(`
name = "p"
completion = "task.complete"
[[role]]
id = "coordinator"
prompt = "x"
emits = ["verify.panel", "task.complete"]
[[role]]
id = "verifier"
prompt = "x"
emits = ["verify.passed", "verify.blocked"]
[handoff]
"loop.start" = ["coordinator"]
"verify.panel" = []
"verify.passed" = ["coordinator"]
"verify.blocked" = ["coordinator"]

[[stage]]
id = "verify"
kind = "verdict"
trigger = "verify.panel"
role = "verifier"
branches = 3
join = "majority-vote"
requires = ["affirm"]
vote_field = "affirm"
on_pass = "verify.passed"
on_fail = "verify.blocked"
`);
    const warnings = validateTopology(topo, { singleFile: true });
    expect(warnings.some((w) => w.kind === "orphan-role")).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("does not flag distinct multi-lens branch roles as orphaned", () => {
    // The multi-lens (N-distinct) shape: three dedicated lens roles referenced
    // only via `roles`, plus a synthesizer referenced only via synthesizer_role.
    const topo = topoFrom(`
name = "p"
completion = "task.complete"
[[role]]
id = "coordinator"
prompt = "x"
emits = ["review.panel", "task.complete"]
[[role]]
id = "security_lens"
prompt = "x"
emits = ["review.done"]
[[role]]
id = "correctness_lens"
prompt = "x"
emits = ["review.done"]
[[role]]
id = "synth"
prompt = "x"
emits = ["review.done"]
[handoff]
"loop.start" = ["coordinator"]
"review.panel" = []
"review.done" = ["coordinator"]

[[stage]]
id = "review"
kind = "discovery"
trigger = "review.panel"
roles = ["security_lens", "correctness_lens"]
join = "synthesize"
requires = ["findings"]
items_field = "findings"
key_field = "id"
synthesizer_role = "synth"
on_pass = "review.done"
on_fail = "review.done"
`);
    const warnings = validateTopology(topo, { singleFile: true });
    expect(warnings.some((w) => w.kind === "orphan-role")).toBe(false);
    expect(warnings).toEqual([]);
  });
});
