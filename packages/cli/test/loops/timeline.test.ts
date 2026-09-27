import type { MetricsRow } from "@mobrienv/autoloop-harness/metrics";
import { describe, expect, it } from "vitest";
import {
  formatDuration,
  renderLiveLine,
  renderStepLine,
} from "../../src/loops/timeline.js";

function makeRow(overrides: Partial<MetricsRow> = {}): MetricsRow {
  return {
    iteration: "3",
    role: "builder-opus",
    event: "review.ready",
    elapsedS: "134",
    exitCode: "0",
    timedOut: "false",
    outcome: "emitted",
    recentEvent: "plan.ready",
    backendKind: "claude-sdk",
    model: "claude-opus-5-5",
    costUsd: 0.1391,
    startedAt: "2026-09-26T20:00:00.000Z",
    finished: true,
    ...overrides,
  };
}

const collapse = (s: string): string => s.replace(/\s+/g, " ");

describe("renderStepLine", () => {
  it("shows step, role, duration, cost, transition, and model", () => {
    expect(collapse(renderStepLine(makeRow(), 200))).toBe(
      "#3 builder-opus 2m14s $0.14 plan.ready → review.ready claude-opus-5-5",
    );
  });

  it("keeps duration and cost when a narrow pane truncates the line", () => {
    const line = renderStepLine(makeRow(), 40);
    expect(line).toContain("2m14s");
    expect(line).toContain("$0.14");
    expect(line).not.toContain("claude-opus-5-5");
  });

  it("falls back to backend kind, omits zero cost, and flags failures", () => {
    const line = renderStepLine(
      makeRow({
        model: "",
        costUsd: 0,
        event: "none",
        outcome: "failed",
        recentEvent: "",
        elapsedS: "",
      }),
      200,
    );
    expect(collapse(line)).toBe(
      "#3 builder-opus 0m00s failed (no event) claude-sdk",
    );
  });

  it("marks timeouts and uses a dash when role and backend are unknown", () => {
    const line = renderStepLine(
      makeRow({ role: "", model: "", backendKind: "", outcome: "timeout" }),
      200,
    );
    expect(collapse(line)).toBe(
      "#3 - 2m14s $0.14 timeout plan.ready → review.ready -",
    );
  });

  it("truncates to the given width with an ellipsis", () => {
    const line = renderStepLine(makeRow(), 20);
    expect([...line]).toHaveLength(20);
    expect(line.endsWith("…")).toBe(true);
    expect(renderStepLine(makeRow(), 1)).toBe("…");
    expect(renderStepLine(makeRow(), 0)).toBe("");
  });
});

describe("renderLiveLine", () => {
  const now = Date.parse("2026-09-26T20:00:42.500Z");

  it("shows the running step with elapsed time since start", () => {
    const row = makeRow({
      iteration: "4",
      role: "critic",
      model: "xai/grok-4.7",
      finished: false,
    });
    expect(collapse(renderLiveLine(row, now, 200))).toBe(
      "▶ #4 critic 0m42s running xai/grok-4.7",
    );
  });

  it("reads zero elapsed for an unparseable or future start", () => {
    expect(renderLiveLine(makeRow({ startedAt: "" }), now, 200)).toMatch(
      /0m00s\s+running/,
    );
    expect(
      renderLiveLine(makeRow(), Date.parse("2026-09-26T19:00:00Z"), 200),
    ).toMatch(/0m00s\s+running/);
  });

  it("truncates to width", () => {
    const line = renderLiveLine(makeRow(), now, 12);
    expect([...line]).toHaveLength(12);
    expect(line.startsWith("▶ #3")).toBe(true);
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(0)).toBe("0m00s");
    expect(formatDuration(709)).toBe("11m49s");
    expect(formatDuration(3723.9)).toBe("1h02m03s");
  });
});
