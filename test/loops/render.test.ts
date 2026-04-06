import { describe, expect, it } from "vitest";
import {
  formatTime,
  renderListHeader,
  renderRunDetail,
  renderRunLine,
} from "../../src/loops/render.js";
import type { RunRecord } from "../../src/registry/types.js";

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: "run-abc12345",
    status: "running",
    preset: "autocode",
    objective: "test objective",
    trigger: "cli",
    backend: "mock",
    backend_args: [],
    iteration: 3,
    max_iterations: 10,
    latest_event: "build.done",
    stop_reason: "",
    created_at: "2026-04-05T14:30:00.000Z",
    updated_at: "2026-04-05T15:45:00.000Z",
    work_dir: "/tmp/work",
    state_dir: "/tmp/state",
    journal_file: "/tmp/journal.jsonl",
    parent_run_id: "",
    isolation_mode: "shared",
    worktree_name: "",
    worktree_path: "",
    ...overrides,
  } as RunRecord;
}

describe("renderListHeader", () => {
  it("includes STARTED column", () => {
    const header = renderListHeader();
    expect(header).toContain("STARTED");
    expect(header).toContain("UPDATED");
    expect(header.indexOf("STARTED")).toBeLessThan(header.indexOf("UPDATED"));
  });

  it("includes ISOLATION column", () => {
    const header = renderListHeader();
    expect(header).toContain("ISOLATION");
    // ISOLATION should appear after PRESET and before ITER
    expect(header.indexOf("ISOLATION")).toBeGreaterThan(
      header.indexOf("PRESET"),
    );
    expect(header.indexOf("ISOLATION")).toBeLessThan(header.indexOf("ITER"));
  });
});

describe("renderRunLine", () => {
  it("includes formatted created_at timestamp", () => {
    const line = renderRunLine(makeRun());
    expect(line).toContain("2026-04-05 ");
    const parts = line.split(/\s{2,}/);
    expect(parts.length).toBeGreaterThanOrEqual(8);
  });

  it("shows dash for missing created_at", () => {
    const line = renderRunLine(makeRun({ created_at: "" }));
    expect(line).toContain("-");
  });

  it("shows isolation_mode in run line", () => {
    const line = renderRunLine(makeRun({ isolation_mode: "worktree" }));
    expect(line).toContain("worktree");
  });

  it("defaults to shared when isolation_mode is empty", () => {
    const line = renderRunLine(makeRun({ isolation_mode: "" }));
    expect(line).toContain("shared");
  });
});

describe("renderRunDetail", () => {
  it("includes isolation field", () => {
    const detail = renderRunDetail(makeRun({ isolation_mode: "worktree" }));
    expect(detail).toContain("Isolation:");
    expect(detail).toContain("worktree");
  });

  it("includes worktree name when present", () => {
    const detail = renderRunDetail(
      makeRun({
        isolation_mode: "worktree",
        worktree_name: "autoloop/run-abc",
        worktree_path: "/tmp/wt",
      }),
    );
    expect(detail).toContain("Worktree:");
    expect(detail).toContain("autoloop/run-abc");
    expect(detail).toContain("WT Path:");
    expect(detail).toContain("/tmp/wt");
  });

  it("omits worktree fields when empty", () => {
    const detail = renderRunDetail(makeRun({ isolation_mode: "shared" }));
    expect(detail).not.toContain("Worktree:");
    expect(detail).not.toContain("WT Path:");
  });
});

describe("formatTime", () => {
  it("formats ISO timestamp to YYYY-MM-DD HH:MM", () => {
    // Use a fixed UTC time and check the local rendering
    const result = formatTime("2026-04-05T14:30:00.000Z");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("returns dash for empty string", () => {
    expect(formatTime("")).toBe("-");
  });

  it("returns original string for invalid date", () => {
    expect(formatTime("not-a-date")).toBe("not-a-date");
  });
});
