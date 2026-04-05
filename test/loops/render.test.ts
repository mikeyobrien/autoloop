import { describe, it, expect } from "vitest";
import {
  renderListHeader,
  renderRunLine,
  formatTime,
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
    latest_event: "build.done",
    stop_reason: "",
    created_at: "2026-04-05T14:30:00.000Z",
    updated_at: "2026-04-05T15:45:00.000Z",
    work_dir: "/tmp/work",
    state_dir: "/tmp/state",
    journal_file: "/tmp/journal.jsonl",
    parent_run_id: "",
    ...overrides,
  } as RunRecord;
}

describe("renderListHeader", () => {
  it("includes STARTED column", () => {
    const header = renderListHeader();
    expect(header).toContain("STARTED");
    expect(header).toContain("UPDATED");
    // STARTED should appear before UPDATED
    expect(header.indexOf("STARTED")).toBeLessThan(header.indexOf("UPDATED"));
  });
});

describe("renderRunLine", () => {
  it("includes formatted created_at timestamp", () => {
    const line = renderRunLine(makeRun());
    // Should contain the formatted created_at
    expect(line).toContain("2026-04-05 ");
    // Should contain both started and updated times
    const parts = line.split(/\s{2,}/);
    expect(parts.length).toBeGreaterThanOrEqual(7);
  });

  it("shows dash for missing created_at", () => {
    const line = renderRunLine(makeRun({ created_at: "" }));
    expect(line).toContain("-");
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
