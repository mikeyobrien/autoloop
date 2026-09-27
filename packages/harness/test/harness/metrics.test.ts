import { encodeEvent } from "@mobrienv/autoloop-core";
import {
  collectMetricsRows,
  formatMetrics,
} from "@mobrienv/autoloop-harness/metrics";
import { describe, expect, it } from "vitest";

describe("collectMetricsRows", () => {
  it("collects rows from typed journal events", () => {
    const lines = [
      encodeEvent({
        shape: "fields",
        run: "r1",
        iteration: "1",
        topic: "iteration.start",
        fields: { suggested_roles: "planner" },
      }),
      encodeEvent({
        shape: "payload",
        run: "r1",
        iteration: "1",
        topic: "tasks.ready",
        payload: "planned",
        source: "agent",
      }),
      encodeEvent({
        shape: "fields",
        run: "r1",
        iteration: "1",
        topic: "iteration.finish",
        fields: { exit_code: "0", timed_out: "false", elapsed_s: "1" },
        rawFields: { exit_code: 0, timed_out: false, elapsed_s: 1 },
      }),
    ];
    const rows = collectMetricsRows(lines);
    expect(rows).toHaveLength(1);
    expect(rows[0].iteration).toBe("1");
    expect(rows[0].role).toBe("planner");
    expect(rows[0].event).toBe("tasks.ready");
    expect(rows[0].outcome).toBe("emitted");
  });

  function start(iter: string, fields: Record<string, string>, ts: string) {
    return JSON.stringify({
      run: "r1",
      iteration: iter,
      topic: "iteration.start",
      ts,
      v: 1,
      fields,
    });
  }
  function line(iter: string, topic: string, fields: Record<string, unknown>) {
    return JSON.stringify({ run: "r1", iteration: iter, topic, v: 1, fields });
  }

  it("prefers backend.start role and model, sums cost, and keeps the in-flight step", () => {
    const lines = [
      start(
        "1",
        { suggested_roles: "builder,critic", recent_event: "plan.ready" },
        "2026-09-26T20:00:00.000Z",
      ),
      line("1", "backend.start", {
        backend_kind: "claude-sdk",
        role: "builder-opus",
        model: "claude-opus-5-5",
      }),
      line("1", "backend.usage", { cost_usd: 0.1 }),
      line("1", "backend.usage", { cost_usd: 0.04 }),
      JSON.stringify({
        run: "r1",
        iteration: "1",
        topic: "review.ready",
        payload: "done",
        source: "agent",
      }),
      line("1", "iteration.finish", {
        exit_code: "0",
        timed_out: false,
        elapsed_s: "134",
      }),
      start(
        "2",
        { suggested_roles: "critic", recent_event: "review.ready" },
        "2026-09-26T20:02:14.000Z",
      ),
      line("2", "backend.start", { backend_kind: "pi" }),
    ];
    const rows = collectMetricsRows(lines);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      iteration: "1",
      role: "builder-opus",
      model: "claude-opus-5-5",
      backendKind: "claude-sdk",
      recentEvent: "plan.ready",
      event: "review.ready",
      elapsedS: "134",
      startedAt: "2026-09-26T20:00:00.000Z",
      finished: true,
      outcome: "emitted",
    });
    expect(rows[0].costUsd).toBeCloseTo(0.14);
    expect(rows[1]).toMatchObject({
      iteration: "2",
      role: "critic",
      model: "",
      backendKind: "pi",
      costUsd: 0,
      startedAt: "2026-09-26T20:02:14.000Z",
      finished: false,
    });
  });

  it("falls back to the first suggested role when backend.start role is empty", () => {
    const rows = collectMetricsRows([
      start("1", { suggested_roles: "planner,critic" }, "not-a-date"),
      line("1", "backend.start", { backend_kind: "pi", role: "", model: "m" }),
      line("1", "backend.usage", { cost_usd: "n/a" }),
      line("9", "backend.start", { backend_kind: "orphan" }),
      line("9", "backend.usage", { cost_usd: 1 }),
      JSON.stringify({ run: "r1", iteration: "1", topic: "iteration.start" }),
    ]);
    expect(rows[0]).toMatchObject({ role: "planner", model: "m", costUsd: 0 });
    expect(rows[0].startedAt).toBe("not-a-date");
    expect(rows[1].startedAt).toBe("");
  });

  it("adds model and cost_usd to every metrics format", () => {
    const rows = collectMetricsRows([
      start("1", { suggested_roles: "b" }, "2026-09-26T20:00:00.000Z"),
      line("1", "backend.start", { backend_kind: "pi", model: "x/y" }),
      line("1", "backend.usage", { cost_usd: 0.1 + 0.2 }),
      line("1", "iteration.finish", { exit_code: "0", elapsed_s: "5" }),
    ]);
    expect(formatMetrics(rows, "csv")).toBe(
      "iteration,role,event,elapsed_s,exit_code,timed_out,outcome,model,cost_usd\n" +
        "1,b,none,5,0,,continue,x/y,0.3",
    );
    const json = JSON.parse(formatMetrics(rows, "json"));
    expect(json[0]).toMatchObject({ model: "x/y", cost_usd: 0.3 });
    const md = formatMetrics(rows, "terminal");
    expect(md).toContain("cost_usd");
    expect(md).toContain("x/y");
  });

  it("tolerates sparse events and formats edge cases", () => {
    const rows = collectMetricsRows([
      "not json",
      JSON.stringify({ run: "r1", topic: "iteration.start", fields: {} }),
      JSON.stringify({ run: "r1", topic: "backend.start", fields: {} }),
      JSON.stringify({ run: "r1", topic: "backend.usage", fields: {} }),
      JSON.stringify({ run: "r1", topic: 'say "hi", ok', payload: "p" }),
      JSON.stringify({
        run: "r1",
        topic: "iteration.finish",
        fields: { timed_out: "true" },
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      iteration: "",
      role: "",
      backendKind: "",
      event: 'say "hi", ok',
      outcome: "timeout",
      finished: true,
    });
    expect(formatMetrics(rows, "csv")).toContain('"say ""hi"", ok"');
    const json = JSON.parse(formatMetrics(rows, "json"));
    expect(json[0]).toMatchObject({
      iteration: null,
      elapsed_s: null,
      timed_out: true,
      cost_usd: 0,
    });
    expect(formatMetrics([], "md")).toBe("No metrics data available.");
    expect(formatMetrics([], "json")).toBe("[]");
    expect(formatMetrics([], "csv")).toMatch(/^iteration,.*cost_usd$/);
  });
});
