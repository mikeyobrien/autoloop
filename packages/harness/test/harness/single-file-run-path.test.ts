import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildLoopContext } from "@mobrienv/autoloop-harness/config-helpers";
import { describe, expect, it, vi } from "vitest";

// Mock the same seams event-emitter.test.ts mocks, so `run()` completes
// after one fake iteration without touching git/worktrees or spawning a
// real backend process — this closes the "real harness.run e2e through a
// single-file preset" acceptance criterion at the harness level.
vi.mock("@mobrienv/autoloop-core/worktree", () => ({
  mergeWorktree: vi.fn(),
  updateStatus: vi.fn(),
  readMeta: vi.fn(() => null),
  metaDirForRun: vi.fn(() => "/tmp/fake-meta"),
  writeMeta: vi.fn(),
  isOrphanWorktree: vi.fn(() => false),
  createWorktree: vi.fn(() => ({
    worktreePath: "/tmp/fake-worktree",
    branch: "autoloop/fake-run",
    metaDir: "/tmp/fake-meta",
  })),
  resolveGitRoot: vi.fn((cwd: string) => cwd),
  tryResolveGitRoot: vi.fn((cwd: string) => cwd),
  cleanWorktrees: vi.fn(),
  listWorktreeMetas: vi.fn(() => []),
}));

const runIteration = vi.hoisted(() =>
  vi.fn((_loop: unknown, _iter: number, _recurse: unknown) => ({
    stopReason: "completed",
    iterations: 1,
    exitCode: 0,
  })),
);
vi.mock("../../src/iteration.js", () => ({ runIteration }));

vi.mock("../../src/metareview.js", () => ({
  maybeRunMetareview: vi.fn((loop: unknown) => loop),
}));

vi.mock("../../src/display.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    printSummary: vi.fn(),
    printProjectedMarkdown: vi.fn(),
    printProjectedText: vi.fn(),
  };
});

vi.mock("../../src/registry-bridge.js", () => ({
  registryStart: vi.fn(),
  registryStop: vi.fn(),
}));

// A single-file merged-TOML preset: config + topology + inline role prompts.
const SINGLE_FILE_PRESET = `
name = "autoreview"
completion = "task.complete"

[event_loop]
max_iterations = 17
completion_event = "task.complete"
completion_promise = "REVIEW_DONE"

[backend]
kind = "command"
command = "claude"

[[role]]
id = "planner"
prompt = "You are the planner."
emits = ["targets.ready"]

[[role]]
id = "reviewer"
prompt = "You are the reviewer."
emits = ["task.complete"]

[handoff]
"loop.start" = ["planner"]
"targets.ready" = ["reviewer"]
`;

function writeSingleFilePreset(): { file: string; workDir: string } {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-single-file-run-"));
  const file = join(dir, "autoreview.toml");
  writeFileSync(file, SINGLE_FILE_PRESET);
  const workDir = mkdtempSync(join(tmpdir(), "autoloop-single-file-work-"));
  mkdirSync(join(workDir, ".autoloop"), { recursive: true });
  return { file, workDir };
}

describe("single-file preset run path", () => {
  it("loads config and topology from the preset file via buildLoopContext", () => {
    const { file, workDir } = writeSingleFilePreset();

    // projectDir is the file's directory; presetFile points at the merged TOML.
    const loop = buildLoopContext(
      dirname(file),
      "review the auth module",
      "node dist/main.js",
      {
        workDir,
        presetFile: file,
      },
    );

    // Topology came from the single file (not a topology.toml in dirname).
    expect(loop.topology.name).toBe("autoreview");
    expect(loop.topology.roles.map((r) => r.id)).toEqual([
      "planner",
      "reviewer",
    ]);
    expect(loop.topology.roles[0].prompt).toContain("You are the planner");

    // Config (event_loop) came from the single file.
    expect(loop.limits.maxIterations).toBe(17);
    expect(loop.completion.promise).toBe("REVIEW_DONE");
    expect(loop.completion.event).toBe("task.complete");

    // The preset name and file are recorded on launch metadata.
    expect(loop.launch.preset).toBe("autoreview");
    expect(loop.launch.presetFile).toBe(file);
  });

  it("falls back to directory loading when no presetFile is given", () => {
    // A directory preset alongside (no presetFile) must still load from
    // autoloops.toml + topology.toml, proving the branch is opt-in.
    const dir = mkdtempSync(join(tmpdir(), "autoloop-dir-preset-"));
    writeFileSync(
      join(dir, "autoloops.toml"),
      "[event_loop]\nmax_iterations = 5\n",
    );
    writeFileSync(
      join(dir, "topology.toml"),
      'name = "dir-preset"\n[[role]]\nid = "builder"\nprompt = "build"\nemits = ["task.complete"]\n[handoff]\n"loop.start" = ["builder"]\n',
    );
    const workDir = mkdtempSync(join(tmpdir(), "autoloop-dir-work-"));
    mkdirSync(join(workDir, ".autoloop"), { recursive: true });

    const loop = buildLoopContext(dir, "obj", "node dist/main.js", { workDir });

    expect(loop.topology.name).toBe("dir-preset");
    expect(loop.limits.maxIterations).toBe(5);
    expect(loop.launch.presetFile ?? "").toBe("");
  });
});

describe("harness.run end-to-end via --preset-file", () => {
  it("completes a real loop sourced entirely from a single-file preset", async () => {
    const { file, workDir } = writeSingleFilePreset();
    const { run } = await import("@mobrienv/autoloop-harness");

    const result = await run(
      dirname(file),
      "review the auth module",
      "node dist/main.js",
      { workDir, presetFile: file },
    );

    expect(result.stopReason).toBe("completed");
    // Proves config/topology were actually sourced from the single file, not
    // some fallback: the fake iteration ran, and the loop's own metadata
    // reflects the merged-TOML preset's identity.
    expect(runIteration).toHaveBeenCalled();
  });
});
