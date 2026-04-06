import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LoopContext } from "../../src/harness/types.js";
import {
  registryComplete,
  registryProgress,
  registryStart,
  registryStop,
} from "../../src/registry/harness.js";
import type { RunRecord } from "../../src/registry/types.js";

let tmpDir: string;
let regPath: string;

function makeLoopContext(
  overrides: Partial<{
    runId: string;
    preset: string;
    isolationMode: string;
    worktreeBranch: string;
    worktreePath: string;
  }> = {},
): LoopContext {
  return {
    objective: "test objective",
    launch: {
      preset: overrides.preset ?? "autocode",
      trigger: "cli",
      createdAt: "2026-01-01T00:00:00Z",
      parentRunId: "",
    },
    backend: {
      kind: "command",
      command: "echo",
      args: ["--fast"],
      promptMode: "arg",
      timeoutMs: 5000,
    },
    paths: {
      projectDir: "/tmp/proj",
      workDir: "/tmp/proj",
      stateDir: "/tmp/state",
      journalFile: "/tmp/state/journal.jsonl",
      registryFile: regPath,
      memoryFile: "/tmp/state/memory.md",
      toolPath: "/tmp/tool",
      piAdapterPath: "/tmp/pi",
      baseStateDir: "/tmp/base",
      mainProjectDir: "/tmp/proj",
      worktreeBranch: overrides.worktreeBranch ?? "",
      worktreePath: overrides.worktreePath ?? "",
      worktreeMetaDir: "",
    },
    runtime: {
      runId: overrides.runId ?? "test-run-001",
      selfCommand: "autoloop",
      promptOverride: null,
      backendOverride: {},
      logLevel: "info",
      branchMode: false,
      isolationMode: overrides.isolationMode ?? "shared",
    },
    limits: { maxIterations: 10 },
  } as unknown as LoopContext;
}

function readLines(): RunRecord[] {
  const text = readFileSync(regPath, "utf-8");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

beforeEach(() => {
  tmpDir = join(tmpdir(), `reg-harness-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  regPath = join(tmpDir, "registry.jsonl");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("registryStart", () => {
  it("appends a running record with correct fields", () => {
    const loop = makeLoopContext();
    registryStart(loop);
    const records = readLines();
    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.run_id).toBe("test-run-001");
    expect(r.status).toBe("running");
    expect(r.preset).toBe("autocode");
    expect(r.objective).toBe("test objective");
    expect(r.trigger).toBe("cli");
    expect(r.iteration).toBe(0);
    expect(r.latest_event).toBe("loop.start");
    expect(r.isolation_mode).toBe("shared");
    expect(r.backend).toBe("echo");
    expect(r.backend_args).toEqual(["--fast"]);
  });

  it("includes worktree fields when set", () => {
    const loop = makeLoopContext({
      worktreeBranch: "wt-branch",
      worktreePath: "/tmp/wt",
    });
    registryStart(loop);
    const r = readLines()[0];
    expect(r.worktree_name).toBe("wt-branch");
    expect(r.worktree_path).toBe("/tmp/wt");
  });
});

describe("registryProgress", () => {
  it("appends a progress record with updated iteration", () => {
    const loop = makeLoopContext();
    registryStart(loop);
    registryProgress(loop, 3);
    const records = readLines();
    expect(records).toHaveLength(2);
    expect(records[1].iteration).toBe(3);
    expect(records[1].latest_event).toBe("iteration.finish");
    expect(records[1].status).toBe("running");
  });
});

describe("registryComplete", () => {
  it("appends a completed record", () => {
    const loop = makeLoopContext();
    registryStart(loop);
    registryComplete(loop, 5, "task.complete");
    const records = readLines();
    expect(records).toHaveLength(2);
    const r = records[1];
    expect(r.status).toBe("completed");
    expect(r.stop_reason).toBe("task.complete");
    expect(r.latest_event).toBe("loop.complete");
    expect(r.iteration).toBe(5);
  });
});

describe("registryStop", () => {
  it("appends a failed record for backend_failed", () => {
    const loop = makeLoopContext();
    registryStart(loop);
    registryStop(loop, 2, "backend_failed");
    const records = readLines();
    const r = records[1];
    expect(r.status).toBe("failed");
    expect(r.stop_reason).toBe("backend_failed");
    expect(r.latest_event).toBe("loop.stop");
  });

  it("appends a timed_out record for backend_timeout", () => {
    const loop = makeLoopContext();
    registryStart(loop);
    registryStop(loop, 2, "backend_timeout");
    const r = readLines()[1];
    expect(r.status).toBe("timed_out");
  });

  it("appends a stopped record for max_iterations", () => {
    const loop = makeLoopContext();
    registryStart(loop);
    registryStop(loop, 10, "max_iterations");
    const r = readLines()[1];
    expect(r.status).toBe("stopped");
    expect(r.stop_reason).toBe("max_iterations");
  });
});
