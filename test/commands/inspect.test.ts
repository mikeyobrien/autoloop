import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Test inspect journal CLI dispatch and parseInspectArgs --run flag.
 */

vi.mock("../../src/harness/index.js", () => ({
  renderJournal: vi.fn(),
  renderAllJournals: vi.fn(),
  renderScratchpadFormat: vi.fn(),
  renderCoordinationFormat: vi.fn(),
  renderMetrics: vi.fn(),
  renderMetricsForRun: vi.fn(),
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
  stateDirPath: vi.fn((d: string) => d + "/.autoloop"),
}));

vi.mock("../../src/topology.js", () => ({
  loadTopology: vi.fn(() => ({ roles: [] })),
}));

vi.mock("../../src/profiles.js", () => ({
  resolveProfileFragments: vi.fn(() => ({ fragments: new Map(), warnings: [] })),
}));

vi.mock("../../src/usage.js", () => ({
  printInspectUsage: vi.fn(),
}));

import { dispatchInspect } from "../../src/commands/inspect.js";
import * as harness from "../../src/harness/index.js";

describe("dispatchInspect journal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set a fallback project dir
    process.env["MINILOOPS_PROJECT_DIR"] = "/tmp/test-project";
  });

  it("dispatches 'inspect journal' to renderAllJournals", () => {
    dispatchInspect(["journal"]);
    expect(harness.renderAllJournals).toHaveBeenCalledTimes(1);
    expect(harness.renderJournal).not.toHaveBeenCalled();
  });

  it("dispatches 'inspect journal --run <id>' to renderJournal with run ID", () => {
    dispatchInspect(["journal", "--run", "abc-123"]);
    expect(harness.renderJournal).toHaveBeenCalledWith(expect.any(String), "abc-123");
    expect(harness.renderAllJournals).not.toHaveBeenCalled();
  });

  it("dispatches 'inspect journal' with explicit project dir", () => {
    dispatchInspect(["journal", "/some/project"]);
    expect(harness.renderAllJournals).toHaveBeenCalledWith("/some/project");
  });

  it("dispatches 'inspect journal --run <id>' with explicit project dir", () => {
    dispatchInspect(["journal", "--run", "run-xyz", "/my/project"]);
    expect(harness.renderJournal).toHaveBeenCalledWith("/my/project", "run-xyz");
  });
});
