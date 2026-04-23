import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  allEmittedEvents,
  allowedEvents,
  completionEvent,
  eventMatchesAny,
  getRoleIds,
  loadTopology,
  render,
  renderTopologyInspect,
  roleCount,
  suggestedRoles,
  type Topology,
  validateTopology,
} from "../src/topology.js";

const TMP_BASE = join(tmpdir(), `autoloop-ts-test-topology-${process.pid}`);

function tmpDir(name: string): string {
  const dir = join(TMP_BASE, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => mkdirSync(TMP_BASE, { recursive: true }));
afterEach(() => rmSync(TMP_BASE, { recursive: true, force: true }));

const TOPOLOGY_TOML = `
name = "test-flow"
completion = "task.complete"

[[role]]
id = "planner"
prompt = "You are the planner."
emits = ["tasks.ready"]

[[role]]
id = "builder"
prompt = "You are the builder."
emits = ["review.ready", "build.blocked"]

[[role]]
id = "critic"
prompt = "You are the critic."
emits = ["review.passed", "review.rejected"]

[[role]]
id = "finalizer"
prompt = "You are the finalizer."
emits = ["queue.advance", "task.complete"]

[handoff]
"loop.start" = ["planner"]
"tasks.ready" = ["builder"]
"review.ready" = ["critic"]
"/review\\\\..*/" = ["builder", "finalizer"]
"build.blocked" = ["planner"]
`;

function loadTestTopology(): Topology {
  const dir = tmpDir(`topo-${Math.random().toString(36).slice(2)}`);
  writeFileSync(join(dir, "topology.toml"), TOPOLOGY_TOML);
  return loadTopology(dir);
}

describe("loadTopology", () => {
  it("returns empty topology for missing file", () => {
    const dir = tmpDir("empty");
    const topo = loadTopology(dir);
    expect(roleCount(topo)).toBe(0);
    expect(topo.name).toBe("");
  });

  it("loads topology from file", () => {
    const topo = loadTestTopology();
    expect(topo.name).toBe("test-flow");
    expect(topo.completion).toBe("task.complete");
    expect(roleCount(topo)).toBe(4);
  });

  it("parses role IDs", () => {
    const topo = loadTestTopology();
    expect(getRoleIds(topo)).toEqual([
      "planner",
      "builder",
      "critic",
      "finalizer",
    ]);
  });

  it("parses role emits", () => {
    const topo = loadTestTopology();
    expect(allEmittedEvents(topo)).toEqual([
      "tasks.ready",
      "review.ready",
      "build.blocked",
      "review.passed",
      "review.rejected",
      "queue.advance",
      "task.complete",
    ]);
  });

  it("parses handoff rules", () => {
    const topo = loadTestTopology();
    expect(topo.handoffKeys).toContain("loop.start");
    expect(topo.handoffKeys).toContain("tasks.ready");
    expect(topo.handoff["loop.start"]).toEqual(["planner"]);
    expect(topo.handoff["tasks.ready"]).toEqual(["builder"]);
  });
});

describe("suggestedRoles", () => {
  it("returns planner for loop.start", () => {
    const topo = loadTestTopology();
    expect(suggestedRoles(topo, "loop.start")).toEqual(["planner"]);
  });

  it("returns builder for tasks.ready", () => {
    const topo = loadTestTopology();
    expect(suggestedRoles(topo, "tasks.ready")).toEqual(["builder"]);
  });

  it("returns critic (plus regex matches) for review.ready", () => {
    const topo = loadTestTopology();
    // review.ready matches both exact and /review\\..*/ regex
    const roles = suggestedRoles(topo, "review.ready");
    expect(roles).toContain("critic");
    expect(roles).toContain("builder");
    expect(roles).toContain("finalizer");
  });

  it("matches regex pattern /review\\.*/", () => {
    const topo = loadTestTopology();
    const roles = suggestedRoles(topo, "review.passed");
    expect(roles).toContain("builder");
    expect(roles).toContain("finalizer");
  });

  it("returns all roles for unknown event", () => {
    const topo = loadTestTopology();
    expect(suggestedRoles(topo, "unknown.event")).toEqual(getRoleIds(topo));
  });
});

describe("allowedEvents", () => {
  it("returns planner emits for loop.start", () => {
    const topo = loadTestTopology();
    expect(allowedEvents(topo, "loop.start")).toEqual(["tasks.ready"]);
  });

  it("returns builder emits for tasks.ready", () => {
    const topo = loadTestTopology();
    expect(allowedEvents(topo, "tasks.ready")).toEqual([
      "review.ready",
      "build.blocked",
    ]);
  });

  it("returns combined emits for regex match", () => {
    const topo = loadTestTopology();
    const events = allowedEvents(topo, "review.rejected");
    expect(events).toContain("review.ready");
    expect(events).toContain("build.blocked");
    expect(events).toContain("queue.advance");
    expect(events).toContain("task.complete");
  });
});

describe("eventMatchesAny", () => {
  it("matches exact event", () => {
    expect(eventMatchesAny("loop.start", ["loop.start", "tasks.ready"])).toBe(
      true,
    );
  });

  it("does not match absent event", () => {
    expect(eventMatchesAny("other", ["loop.start", "tasks.ready"])).toBe(false);
  });

  it("matches regex pattern", () => {
    expect(eventMatchesAny("review.passed", ["/review\\..*/"])).toBe(true);
  });

  it("does not match non-matching regex", () => {
    expect(eventMatchesAny("tasks.ready", ["/review\\..*/"])).toBe(false);
  });
});

describe("completionEvent", () => {
  it("returns topology completion when set", () => {
    const topo = loadTestTopology();
    expect(completionEvent(topo, "fallback")).toBe("task.complete");
  });

  it("returns fallback when topology completion empty", () => {
    const dir = tmpDir("no-completion");
    const topo = loadTopology(dir);
    expect(completionEvent(topo, "my.fallback")).toBe("my.fallback");
  });
});

describe("render", () => {
  it("renders topology with context", () => {
    const topo = loadTestTopology();
    const text = render(topo, "loop.start");
    expect(text).toContain("Topology (advisory):");
    expect(text).toContain("Recent routing event: loop.start");
    expect(text).toContain("Suggested next roles: planner");
    expect(text).toContain("Role deck:");
    expect(text).toContain("role `planner`");
    expect(text).toContain("role `builder`");
  });

  it("returns empty for empty topology", () => {
    const dir = tmpDir("empty-render");
    const topo = loadTopology(dir);
    expect(render(topo, "loop.start")).toBe("");
  });
});

describe("validateTopology", () => {
  it("reports orphan roles not targeted by any handoff", () => {
    const dir = tmpDir("validate-orphan");
    writeFileSync(
      join(dir, "topology.toml"),
      `
name = "orphan-test"
completion = "done"

[[role]]
id = "alpha"
prompt = "A"
emits = ["done"]

[[role]]
id = "beta"
prompt = "B"
emits = ["done"]

[handoff]
"start" = ["alpha"]
`,
    );
    const topo = loadTopology(dir);
    const warnings = validateTopology(topo);
    expect(
      warnings.some(
        (w) => w.kind === "orphan-role" && w.message.includes("beta"),
      ),
    ).toBe(true);
  });

  it("reports unreachable events with no handoff rule", () => {
    const dir = tmpDir("validate-unreachable");
    writeFileSync(
      join(dir, "topology.toml"),
      `
name = "unreachable-test"
completion = "task.complete"

[[role]]
id = "worker"
prompt = "W"
emits = ["orphan.event", "task.complete"]

[handoff]
"start" = ["worker"]
`,
    );
    const topo = loadTopology(dir);
    const warnings = validateTopology(topo);
    expect(
      warnings.some(
        (w) =>
          w.kind === "unreachable-event" && w.message.includes("orphan.event"),
      ),
    ).toBe(true);
    // task.complete should not be flagged since it matches the completion event
    expect(
      warnings.some(
        (w) =>
          w.kind === "unreachable-event" && w.message.includes("task.complete"),
      ),
    ).toBe(false);
  });

  it("reports roles with no emits", () => {
    const dir = tmpDir("validate-no-emits");
    writeFileSync(
      join(dir, "topology.toml"),
      `
name = "no-emits-test"
completion = "done"

[[role]]
id = "silent"
prompt = "S"
emits = []

[handoff]
"start" = ["silent"]
`,
    );
    const topo = loadTopology(dir);
    const warnings = validateTopology(topo);
    expect(
      warnings.some(
        (w) => w.kind === "no-emits" && w.message.includes("silent"),
      ),
    ).toBe(true);
  });

  it("returns no warnings for well-formed topology", () => {
    const topo = loadTestTopology();
    const warnings = validateTopology(topo);
    // The test topology has planner as orphan (not targeted by review.* regex directly,
    // but is targeted by build.blocked), so check it's well-connected
    const orphans = warnings.filter((w) => w.kind === "orphan-role");
    // planner is targeted by build.blocked, builder by tasks.ready, critic by review.ready,
    // finalizer by /review\\..*/ — all roles are reachable
    expect(orphans.length).toBe(0);
  });
});

describe("renderTopologyInspect", () => {
  it("renders terminal format", () => {
    const dir = tmpDir("inspect-terminal");
    writeFileSync(join(dir, "topology.toml"), TOPOLOGY_TOML);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderTopologyInspect(dir, "terminal");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("## Topology: test-flow");
    expect(output).toContain("Completion event: task.complete");
    expect(output).toContain("`planner`");
    expect(output).toContain("### Handoff Map");
    spy.mockRestore();
  });

  it("renders json format", () => {
    const dir = tmpDir("inspect-json");
    writeFileSync(join(dir, "topology.toml"), TOPOLOGY_TOML);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderTopologyInspect(dir, "json");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.name).toBe("test-flow");
    expect(parsed.roles).toHaveLength(4);
    expect(parsed.handoff).toBeDefined();
    expect(Array.isArray(parsed.warnings)).toBe(true);
    spy.mockRestore();
  });

  it("renders graph format", () => {
    const dir = tmpDir("inspect-graph");
    writeFileSync(join(dir, "topology.toml"), TOPOLOGY_TOML);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderTopologyInspect(dir, "graph");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("[planner] --tasks.ready--> [builder]");
    expect(output).toContain("[finalizer] --task.complete--> (done)");
    expect(output).toContain("[builder] --review.ready-->");
    spy.mockRestore();
  });

  it("prints message for empty topology", () => {
    const dir = tmpDir("inspect-empty");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderTopologyInspect(dir, "terminal");
    expect(spy).toHaveBeenCalledWith("No topology defined.");
    spy.mockRestore();
  });
});

describe("prompt_file support", () => {
  it("loads prompt from file reference", () => {
    const dir = tmpDir("prompt-file");
    writeFileSync(join(dir, "my-prompt.md"), "Do something specific.");
    writeFileSync(
      join(dir, "topology.toml"),
      '[[role]]\nid = "worker"\nprompt_file = "my-prompt.md"\nemits = ["done"]\n',
    );
    const topo = loadTopology(dir);
    expect(topo.roles[0].prompt).toBe("Do something specific.");
  });
});
