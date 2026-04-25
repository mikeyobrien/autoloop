import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { healthSummary } from "../../src/loops/health.js";
import { listRuns } from "../../src/loops/list.js";
import { showRun } from "../../src/loops/show.js";
import { watchRun } from "../../src/loops/watch.js";

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  const now = new Date();
  return {
    run_id: "chain-child-run-001",
    status: "running",
    preset: "autocode",
    objective: "verify chain child visibility",
    trigger: "chain",
    project_dir: "/tmp/project",
    work_dir: "/tmp/project",
    state_dir: "/tmp/project/.autoloop/chains/chain-1/step-1/.autoloop",
    journal_file:
      "/tmp/project/.autoloop/chains/chain-1/step-1/.autoloop/journal.jsonl",
    parent_run_id: "parent-run-001",
    backend: "mock",
    backend_args: [],
    created_at: new Date(now.getTime() - 60_000).toISOString(),
    updated_at: now.toISOString(),
    iteration: 3,
    max_iterations: 10,
    stop_reason: "",
    latest_event: "iteration.finish",
    isolation_mode: "shared",
    worktree_name: "",
    worktree_path: "",
    ...overrides,
  };
}

function writeJsonl(path: string, records: RunRecord[]): void {
  writeFileSync(
    path,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf-8",
  );
}

let stateDir: string;

beforeEach(() => {
  stateDir = join(
    tmpdir(),
    `loops-chain-child-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(stateDir, { recursive: true });
  writeJsonl(join(stateDir, "registry.jsonl"), []);
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeStepRegistry(records: RunRecord[]): void {
  const stepStateDir = join(
    stateDir,
    "chains",
    "chain-inline-1",
    "step-1",
    ".autoloop",
  );
  mkdirSync(stepStateDir, { recursive: true });
  writeJsonl(join(stepStateDir, "registry.jsonl"), records);
}

describe("chain child registry visibility in loops surfaces", () => {
  it("lists an active chain child run even when the root registry is empty", () => {
    writeStepRegistry([makeRecord()]);

    const result = listRuns(stateDir, false);

    expect(result).toContain("chain-child-run-001");
    expect(result).not.toContain("No active runs.");
  });

  it("shows details for a chain child run by prefix", () => {
    writeStepRegistry([makeRecord()]);

    const result = showRun(stateDir, "chain-child-run");

    expect(result).toContain("Run:");
    expect(result).toContain("chain-child-run-001");
    expect(result).toContain("Status:");
    expect(result).toContain("running");
  });

  it("includes an active chain child run in health output", () => {
    writeStepRegistry([makeRecord()]);

    const result = healthSummary(stateDir, false);

    expect(result).toContain("All clear. 1 active");
    expect(result).not.toContain("0 active");
  });

  it("resolves a chain child run in watch mode", async () => {
    writeStepRegistry([
      makeRecord({
        status: "completed",
        stop_reason: "done",
        latest_event: "loop.complete",
      }),
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await watchRun(stateDir, "chain-child-run");

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("[watch] Run already completed.");
    expect(output).toContain("chain-child-run-001");
  });
});
