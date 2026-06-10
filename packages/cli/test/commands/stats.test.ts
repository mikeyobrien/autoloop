import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeStats,
  dispatchStats,
  renderStats,
} from "../../src/commands/stats.js";

function record(overrides: Partial<RunRecord>): RunRecord {
  return {
    run_id: "run-1",
    status: "completed",
    preset: "autocode",
    objective: "",
    trigger: "cli",
    project_dir: "",
    work_dir: "",
    state_dir: "",
    journal_file: "",
    parent_run_id: "",
    backend: "",
    backend_args: [],
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:01:40Z",
    iteration: 4,
    max_iterations: 10,
    stop_reason: "",
    latest_event: "",
    isolation_mode: "",
    worktree_name: "",
    worktree_path: "",
    ...overrides,
  };
}

function usageLine(run: string, costUsd: string): string {
  return JSON.stringify({
    run,
    iteration: "1",
    topic: "backend.usage",
    fields: { cost_usd: costUsd, total_tokens: "100" },
  });
}

describe("computeStats", () => {
  it("groups runs by preset with rates, averages, and cost", () => {
    const records = [
      record({ run_id: "a", preset: "autocode", status: "completed" }),
      record({ run_id: "b", preset: "autocode", status: "failed" }),
      record({ run_id: "c", preset: "autoqa", status: "running" }),
    ];
    const journals: Record<string, string[]> = {
      a: [usageLine("a", "0.40")],
      b: [usageLine("b", "0.10")],
      c: [],
    };
    const stats = computeStats(records, (runId) => journals[runId] ?? []);
    expect(stats).toHaveLength(2);
    const autocode = stats.find((s) => s.preset === "autocode");
    expect(autocode?.runs).toBe(2);
    expect(autocode?.completed).toBe(1);
    expect(autocode?.failed).toBe(1);
    expect(autocode?.successRate).toBeCloseTo(0.5, 6);
    expect(autocode?.avgIterations).toBeCloseTo(4, 6);
    expect(autocode?.avgDurationS).toBeCloseTo(100, 6);
    expect(autocode?.costUsd).toBeCloseTo(0.5, 6);
    const autoqa = stats.find((s) => s.preset === "autoqa");
    expect(autoqa?.running).toBe(1);
    expect(autoqa?.successRate).toBeNull();
  });

  it("counts timed_out runs as failures", () => {
    const stats = computeStats([record({ status: "timed_out" })], () => []);
    expect(stats[0].failed).toBe(1);
  });

  it("skips unparseable durations", () => {
    const stats = computeStats(
      [record({ created_at: "garbage", updated_at: "garbage" })],
      () => [],
    );
    expect(stats[0].avgDurationS).toBeNull();
  });
});

describe("renderStats", () => {
  it("explains when no runs exist", () => {
    expect(renderStats("/tmp/p", [])).toContain("No runs recorded yet");
  });

  it("renders a table with totals", () => {
    const stats = computeStats([record({ run_id: "a" })], () => [
      usageLine("a", "0.25"),
    ]);
    const text = renderStats("/tmp/p", stats);
    expect(text).toContain("## Run stats");
    expect(text).toContain("autocode");
    expect(text).toContain("100%");
    expect(text).toContain("$0.2500 journaled cost");
  });
});

describe("dispatchStats", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads the registry from disk and prints JSON", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "autoloop-stats-test-"));
    const stateDir = join(projectDir, ".autoloop");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "registry.jsonl"),
      `${JSON.stringify(record({ run_id: "a" }))}\n`,
    );
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });
    dispatchStats([projectDir, "--json"]);
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed.presets).toHaveLength(1);
    expect(parsed.presets[0].preset).toBe("autocode");
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("shows usage with --help", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });
    dispatchStats(["--help"]);
    expect(lines.join("\n")).toContain("Usage: autoloop stats");
  });
});
