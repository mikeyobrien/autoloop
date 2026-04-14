import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Verify that inline automerge is skipped when trigger is "chain".
 *
 * Chain-mode runs defer merge to a dedicated automerge preset step;
 * the inline automerge in harness/index.ts must not fire for chain steps.
 */

vi.mock("../../src/worktree/merge.js", () => ({
  mergeWorktree: vi.fn(),
}));

vi.mock("../../src/worktree/meta.js", () => ({
  updateStatus: vi.fn(),
  readMeta: vi.fn(() => ({ merge_strategy: "squash" })),
  metaDirForRun: vi.fn((_dir: string, _runId: string) => "/tmp/fake-meta"),
  writeMeta: vi.fn(),
  isOrphanWorktree: vi.fn(() => false),
}));

vi.mock("../../src/worktree/create.js", () => ({
  createWorktree: vi.fn(() => ({
    worktreePath: "/tmp/fake-worktree",
    branch: "autoloop/fake-run",
    metaDir: "/tmp/fake-meta",
  })),
  resolveGitRoot: vi.fn((cwd: string) => cwd),
}));

vi.mock("../../src/worktree/clean.js", () => ({
  cleanWorktrees: vi.fn(),
}));

vi.mock("../../src/worktree/merge.js", () => ({
  mergeWorktree: vi.fn(),
}));

vi.mock("../../src/harness/iteration.js", () => ({
  runIteration: vi.fn((_loop: unknown, _iter: number, _recurse: unknown) => ({
    stopReason: "completed",
    iterations: 1,
    exitCode: 0,
  })),
}));

vi.mock("../../src/harness/metareview.js", () => ({
  maybeRunMetareview: vi.fn((loop: unknown) => loop),
}));

vi.mock("../../src/harness/display.js", () => ({
  printSummary: vi.fn(),
  log: vi.fn(),
  printProjectedMarkdown: vi.fn(),
  printProjectedText: vi.fn(),
}));

vi.mock("../../src/registry/harness.js", () => ({
  registryStart: vi.fn(),
}));

vi.mock("../../src/harness/parallel.js", () => ({
  loadParallelBranchLaunch: vi.fn(),
  parallelBranchBackendOverride: vi.fn(),
  writeParallelBranchSummary: vi.fn(),
  renderBranchResult: vi.fn(),
  seedBranchContext: vi.fn(),
  branchStopReason: vi.fn(),
  appendLoopStart: vi.fn(),
}));

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/harness/index.js";
import { mergeWorktree } from "../../src/worktree/merge.js";

function makeProject(configToml = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-ts-automerge-chain-"));
  writeFileSync(
    join(dir, "autoloops.toml"),
    configToml || '[backend]\ncommand = "echo"\n',
  );
  writeFileSync(join(dir, "topology.toml"), '[[role]]\nname = "builder"\n');
  const stateDir = join(dir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  const metaDir = join(stateDir, "worktrees", "test-wt");
  mkdirSync(metaDir, { recursive: true });
  writeFileSync(
    join(metaDir, "meta.json"),
    JSON.stringify({
      run_id: "test-run",
      branch: "wt-test",
      merge_strategy: "squash",
      created_at: new Date().toISOString(),
    }),
  );
  return dir;
}

describe("automerge chain guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips inline automerge when trigger is 'chain'", () => {
    const project = makeProject();
    run(project, "test prompt", "autoloop", {
      automerge: true,
      trigger: "chain",
      worktree: true,
    });
    expect(mergeWorktree).not.toHaveBeenCalled();
  });

  it("fires inline automerge when trigger is 'cli'", () => {
    const project = makeProject();
    run(project, "test prompt", "autoloop", {
      automerge: true,
      trigger: "cli",
      worktree: true,
    });
    expect(mergeWorktree).toHaveBeenCalled();
  });

  it("fires inline automerge when trigger is undefined (defaults to cli)", () => {
    const project = makeProject();
    run(project, "test prompt", "autoloop", {
      automerge: true,
      worktree: true,
    });
    expect(mergeWorktree).toHaveBeenCalled();
  });
});
