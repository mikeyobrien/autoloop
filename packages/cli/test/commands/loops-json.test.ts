import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchLoops } from "../../src/commands/loops.js";

function makeRecord(id: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: id,
    status: "completed",
    preset: "autocode",
    objective: "test objective",
    trigger: "cli",
    project_dir: "/tmp/proj",
    work_dir: "/tmp/proj",
    state_dir: "/tmp/proj/.autoloop",
    journal_file: "/tmp/proj/.autoloop/journal.jsonl",
    parent_run_id: "",
    backend: "mock",
    backend_args: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T01:00:00Z",
    iteration: 5,
    max_iterations: 10,
    stop_reason: "completion",
    latest_event: "loop.complete",
    isolation_mode: "shared",
    worktree_name: "",
    worktree_path: "",
    ...overrides,
  };
}

let projectDir: string;
let lines: string[];
let origProjectDir: string | undefined;
let origExitCode: typeof process.exitCode;

beforeEach(() => {
  projectDir = join(
    tmpdir(),
    `loops-json-cmd-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(projectDir, ".autoloop"), { recursive: true });
  origProjectDir = process.env.AUTOLOOP_PROJECT_DIR;
  process.env.AUTOLOOP_PROJECT_DIR = projectDir;
  origExitCode = process.exitCode;
  lines = [];
  vi.spyOn(console, "log").mockImplementation((...args) => {
    lines.push(args.join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = origExitCode;
  if (origProjectDir === undefined) delete process.env.AUTOLOOP_PROJECT_DIR;
  else process.env.AUTOLOOP_PROJECT_DIR = origProjectDir;
  rmSync(projectDir, { recursive: true, force: true });
});

function writeRecords(records: RunRecord[]): void {
  writeFileSync(
    join(projectDir, ".autoloop", "registry.jsonl"),
    `${records.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
}

function output(): string {
  return lines.join("\n");
}

describe("dispatchLoops --json", () => {
  it("loops --json prints a JSON array of active runs", () => {
    writeRecords([
      makeRecord("run-live", { status: "running" }),
      makeRecord("run-done"),
    ]);
    dispatchLoops(["--json"]);
    const parsed = JSON.parse(output());
    expect(parsed).toHaveLength(1);
    expect(parsed[0].run_id).toBe("run-live");
  });

  it("loops --json prints [] when there are no runs", () => {
    dispatchLoops(["--json"]);
    expect(JSON.parse(output())).toEqual([]);
  });

  it("accepts --all and --json in either order", () => {
    writeRecords([
      makeRecord("run-live", { status: "running" }),
      makeRecord("run-done"),
    ]);
    dispatchLoops(["--all", "--json"]);
    const first = output();
    lines = [];
    dispatchLoops(["--json", "--all"]);
    expect(output()).toBe(first);
    const parsed = JSON.parse(first);
    expect(parsed.map((r: { run_id: string }) => r.run_id).sort()).toEqual([
      "run-done",
      "run-live",
    ]);
  });

  it("loops show <id> --json prints the full record", () => {
    writeRecords([makeRecord("run-show-1")]);
    dispatchLoops(["show", "run-show-1", "--json"]);
    const parsed = JSON.parse(output());
    expect(parsed.run_id).toBe("run-show-1");
    expect(parsed.objective).toBe("test objective");
    expect(parsed).toHaveProperty("health");
    expect(process.exitCode).toBe(origExitCode);
  });

  it("loops show <unknown> --json prints an error object and sets exit code 1", () => {
    writeRecords([makeRecord("run-show-1")]);
    dispatchLoops(["show", "zzz", "--json"]);
    const parsed = JSON.parse(output());
    expect(parsed.error).toContain("No run matching");
    expect(process.exitCode).toBe(1);
  });

  it("loops artifacts <id> --json prints artifact paths", () => {
    writeRecords([makeRecord("run-art-1")]);
    dispatchLoops(["artifacts", "run-art-1", "--json"]);
    const parsed = JSON.parse(output());
    expect(parsed.run_id).toBe("run-art-1");
    expect(parsed.journal_file).toBe("/tmp/proj/.autoloop/journal.jsonl");
  });

  it("loops health --json prints bucket counts and run ids", () => {
    writeRecords([
      makeRecord("run-live", {
        status: "running",
        updated_at: new Date().toISOString(),
      }),
    ]);
    dispatchLoops(["health", "--json"]);
    const parsed = JSON.parse(output());
    expect(parsed.active).toEqual({ count: 1, run_ids: ["run-live"] });
    expect(parsed.stuck).toEqual({ count: 0, run_ids: [] });
  });

  it("keeps the human table output unchanged without --json", () => {
    writeRecords([makeRecord("run-live", { status: "running" })]);
    dispatchLoops([]);
    expect(output()).toContain("RUN ID");
    expect(output()).toContain("run-live");
    lines = [];
    dispatchLoops(["health"]);
    expect(output()).toMatch(/^(All clear|Health):?/);
  });
});
