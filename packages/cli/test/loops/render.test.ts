import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { describe, expect, it } from "vitest";
import {
  formatTime,
  renderListHeader,
  renderRunDetail,
  renderRunLine,
} from "../../src/loops/render.js";

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

const step = {
  iteration: 4,
  role: "builder-opus",
  backend_kind: "claude-sdk",
  model: "claude-opus-5-5",
  started_at: "2026-04-05T15:40:00.000Z",
};

describe("renderListHeader", () => {
  it("includes STARTED column", () => {
    const header = renderListHeader();
    expect(header).toContain("STARTED");
    expect(header).toContain("UPDATED");
    expect(header.indexOf("STARTED")).toBeLessThan(header.indexOf("UPDATED"));
  });

  it("includes compact WT column", () => {
    const header = renderListHeader();
    expect(header).toContain("WT");
    expect(header).not.toContain("ISOLATION");
    // WT should appear after PRESET and before ITER
    const wtIdx = header.indexOf("WT");
    expect(wtIdx).toBeGreaterThan(header.indexOf("PRESET"));
    expect(wtIdx).toBeLessThan(header.indexOf("ITER"));
  });
});

describe("renderRunLine", () => {
  it("includes formatted created_at timestamp", () => {
    const run = makeRun();
    const line = renderRunLine(run);
    // Derive the expected local-time rendering so the assertion is
    // timezone-independent (formatTime uses local-time getters).
    const d = new Date(run.created_at);
    const pad = (n: number) => String(n).padStart(2, "0");
    const expectedDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate(),
    )}`;
    expect(line).toContain(`${expectedDate} `);
    const parts = line.split(/\s{2,}/);
    expect(parts.length).toBeGreaterThanOrEqual(8);
  });

  it("shows dash for missing created_at", () => {
    const line = renderRunLine(makeRun({ created_at: "" }));
    expect(line).toContain("-");
  });

  it("shows WT indicator for worktree isolation", () => {
    const line = renderRunLine(makeRun({ isolation_mode: "worktree" }));
    expect(line).toContain("WT");
    expect(line).not.toContain("worktree");
  });

  it("shows dash indicator for shared isolation", () => {
    const line = renderRunLine(makeRun({ isolation_mode: "" }));
    expect(line).toContain("──");
    expect(line).not.toContain("shared");
  });

  it("shows dash indicator for explicit shared mode", () => {
    const line = renderRunLine(makeRun({ isolation_mode: "shared" }));
    expect(line).toContain("──");
  });
});

describe("renderRunLine current step", () => {
  it("shows the step in flight for a running run", () => {
    const line = renderRunLine(makeRun({ current_step: step }));
    expect(line).toContain("iter:4");
    expect(line).toContain("▶ builder-opus");
    expect(line).not.toContain("build.done");
  });

  it("truncates a long role list to the column", () => {
    const line = renderRunLine(
      makeRun({
        status: "waiting",
        current_step: { ...step, role: "planner,builder,critic,finalizer" },
      }),
    );
    expect(line).toContain("▶ planner,build...");
  });

  it("falls back to the last completed iteration without a step", () => {
    const line = renderRunLine(makeRun());
    expect(line).toContain("iter:3");
    expect(line).toContain("build.done");
    expect(line).not.toContain("▶");
  });

  it("ignores a leftover step on a finished run", () => {
    const line = renderRunLine(
      makeRun({ status: "completed", current_step: step }),
    );
    expect(line).toContain("iter:3");
    expect(line).not.toContain("▶");
  });
});

describe("renderRunDetail current step", () => {
  it("renders the step with backend, model, start time, and age", () => {
    const started = new Date(step.started_at);
    const pad = (n: number) => String(n).padStart(2, "0");
    const clock = `${pad(started.getHours())}:${pad(started.getMinutes())}:${pad(started.getSeconds())}`;
    const detail = renderRunDetail(
      makeRun({ current_step: step }),
      started.getTime() + 125_000,
    );
    expect(detail).toContain(
      `Step:       4 builder-opus · claude-sdk · claude-opus-5-5 · started ${clock} (2m 5s ago)`,
    );
    expect(detail).toContain("Iteration:  3");
  });

  it("renders an unset model as default and skips an unreadable start", () => {
    const detail = renderRunDetail(
      makeRun({ current_step: { ...step, model: "", started_at: "soon" } }),
    );
    expect(detail).toContain(
      "Step:       4 builder-opus · claude-sdk · default",
    );
    expect(detail).not.toContain("started");
  });

  it("omits the step line without a step in flight", () => {
    expect(renderRunDetail(makeRun())).not.toContain("Step:");
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
