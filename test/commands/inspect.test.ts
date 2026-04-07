import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Test inspect journal CLI dispatch and parseInspectArgs --run flag.
 */

vi.mock("../../src/harness/index.js", () => ({
  renderJournal: vi.fn(),
  renderAllJournals: vi.fn(),
  renderJournalTimeline: vi.fn(),
  renderArtifacts: vi.fn(),
  renderScratchpadFormat: vi.fn(),
  renderCoordinationFormat: vi.fn(),
  renderMetrics: vi.fn(),
  renderPromptFormat: vi.fn(),
  renderOutput: vi.fn(),
}));

vi.mock("../../src/memory.js", () => ({
  rawProject: vi.fn(() => "{}"),
  listProject: vi.fn(() => ""),
}));

vi.mock("../../src/chains.js", () => ({
  renderChainState: vi.fn(() => ""),
}));

vi.mock("../../src/config.js", () => ({
  loadProject: vi.fn(() => ({})),
  getProfileDefaults: vi.fn(() => []),
  stateDirPath: vi.fn((d: string) => `${d}/.autoloop`),
}));

vi.mock("../../src/topology.js", () => ({
  loadTopology: vi.fn(() => ({ roles: [] })),
  renderTopologyInspect: vi.fn(),
}));

vi.mock("../../src/profiles.js", () => ({
  resolveProfileFragments: vi.fn(() => ({
    fragments: new Map(),
    warnings: [],
  })),
}));

vi.mock("../../src/usage.js", () => ({
  printInspectUsage: vi.fn(),
}));

import { dispatchInspect } from "../../src/commands/inspect.js";
import * as harness from "../../src/harness/index.js";
import * as topo from "../../src/topology.js";

describe("dispatchInspect journal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set a fallback project dir
    process.env.AUTOLOOP_PROJECT_DIR = "/tmp/test-project";
  });

  it("dispatches 'inspect journal' to renderJournalTimeline (default terminal format)", () => {
    dispatchInspect(["journal"]);
    expect(harness.renderJournalTimeline).toHaveBeenCalledTimes(1);
    expect(harness.renderJournalTimeline).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ artifact: "journal" }),
    );
  });

  it("dispatches 'inspect journal --json' to renderAllJournals (backward compat)", () => {
    dispatchInspect(["journal", "--json"]);
    expect(harness.renderAllJournals).toHaveBeenCalledTimes(1);
    expect(harness.renderJournalTimeline).not.toHaveBeenCalled();
  });

  it("dispatches 'inspect journal --run <id> --json' to renderJournal", () => {
    dispatchInspect(["journal", "--run", "abc-123", "--json"]);
    expect(harness.renderJournal).toHaveBeenCalledWith(
      expect.any(String),
      "abc-123",
    );
    expect(harness.renderAllJournals).not.toHaveBeenCalled();
  });

  it("dispatches 'inspect journal --topic loop --iter 3'", () => {
    dispatchInspect(["journal", "--topic", "loop", "--iter", "3"]);
    expect(harness.renderJournalTimeline).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        topics: ["loop"],
        iterFilter: "3",
      }),
    );
  });

  it("dispatches 'inspect journal --all-runs'", () => {
    dispatchInspect(["journal", "--all-runs"]);
    expect(harness.renderJournalTimeline).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ allRuns: true }),
    );
  });

  it("dispatches 'inspect artifacts' to renderArtifacts", () => {
    dispatchInspect(["artifacts"]);
    expect(harness.renderArtifacts).toHaveBeenCalledWith(
      expect.any(String),
      "terminal",
      undefined,
    );
  });

  it("dispatches 'inspect artifacts --run <id> --json'", () => {
    dispatchInspect(["artifacts", "--run", "run-xyz", "--json"]);
    expect(harness.renderArtifacts).toHaveBeenCalledWith(
      expect.any(String),
      "json",
      "run-xyz",
    );
  });
});

describe("dispatchInspect topology", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTOLOOP_PROJECT_DIR = "/tmp/test-project";
  });

  it("dispatches 'inspect topology' to renderTopologyInspect", () => {
    dispatchInspect(["topology"]);
    expect(topo.renderTopologyInspect).toHaveBeenCalledWith(
      expect.any(String),
      "terminal",
    );
  });

  it("dispatches 'inspect topology --format graph'", () => {
    dispatchInspect(["topology", "--format", "graph"]);
    expect(topo.renderTopologyInspect).toHaveBeenCalledWith(
      expect.any(String),
      "graph",
    );
  });

  it("dispatches 'inspect topology --format json'", () => {
    dispatchInspect(["topology", "--format", "json"]);
    expect(topo.renderTopologyInspect).toHaveBeenCalledWith(
      expect.any(String),
      "json",
    );
  });

  it("dispatches 'inspect topology --run <id>' (run ignored, topology is static)", () => {
    dispatchInspect(["topology", "--run", "run-abc"]);
    expect(topo.renderTopologyInspect).toHaveBeenCalledWith(
      expect.any(String),
      "terminal",
    );
  });
});

describe("dispatchInspect catch-all error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTOLOOP_PROJECT_DIR = "/tmp/test-project";
  });

  it("prints valid targets for unknown artifact", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    dispatchInspect(["bogus"]);
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Unknown inspect target `bogus`");
    expect(output).toContain("Valid targets:");
    expect(output).toContain("topology");
    spy.mockRestore();
  });

  it("suggests closest target for near-miss", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    dispatchInspect(["topolog"]);
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Did you mean `topology`");
    spy.mockRestore();
  });
});
