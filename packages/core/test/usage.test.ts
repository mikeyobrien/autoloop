import { describe, expect, it } from "vitest";
import { encodeEvent } from "../src/events/encode.js";
import { collectUsage, emptyUsageTotals, formatUsage } from "../src/usage.js";

function usageLine(
  run: string,
  iteration: string,
  fields: Record<string, string>,
): string {
  return encodeEvent({
    shape: "fields",
    run,
    iteration,
    topic: "backend.usage",
    fields,
  });
}

describe("collectUsage", () => {
  it("aggregates backend.usage events into rows and totals", () => {
    const lines = [
      encodeEvent({
        shape: "fields",
        run: "r1",
        iteration: "1",
        topic: "iteration.start",
        fields: { suggested_roles: "planner" },
      }),
      usageLine("r1", "1", {
        input_tokens: "2500",
        output_tokens: "850",
        cache_read_tokens: "0",
        cache_write_tokens: "500",
        total_tokens: "3850",
        cost_usd: "0.0192",
        context_percent: "42",
      }),
      usageLine("r1", "2", {
        input_tokens: "1000",
        output_tokens: "200",
        cache_read_tokens: "300",
        cache_write_tokens: "0",
        total_tokens: "1500",
        cost_usd: "0.01",
      }),
    ];
    const usage = collectUsage(lines);
    expect(usage.rows).toHaveLength(2);
    expect(usage.rows[0].iteration).toBe("1");
    expect(usage.rows[0].contextPercent).toBe(42);
    expect(usage.rows[1].contextPercent).toBeUndefined();
    expect(usage.totals.iterations).toBe(2);
    expect(usage.totals.inputTokens).toBe(3500);
    expect(usage.totals.totalTokens).toBe(5350);
    expect(usage.totals.costUsd).toBeCloseTo(0.0292, 6);
  });

  it("filters by runId when given", () => {
    const lines = [
      usageLine("r1", "1", { cost_usd: "0.5", total_tokens: "10" }),
      usageLine("r2", "1", { cost_usd: "0.7", total_tokens: "20" }),
    ];
    const usage = collectUsage(lines, "r2");
    expect(usage.rows).toHaveLength(1);
    expect(usage.totals.costUsd).toBeCloseTo(0.7, 6);
  });

  it("treats missing or malformed numbers as zero", () => {
    const lines = [
      usageLine("r1", "1", { cost_usd: "not-a-number" }),
      "not json at all",
    ];
    const usage = collectUsage(lines);
    expect(usage.rows).toHaveLength(1);
    expect(usage.totals.costUsd).toBe(0);
    expect(usage.totals.inputTokens).toBe(0);
  });

  it("returns empty totals for an empty journal", () => {
    const usage = collectUsage([]);
    expect(usage.rows).toHaveLength(0);
    expect(usage.totals).toEqual(emptyUsageTotals());
  });
});

describe("formatUsage", () => {
  const usage = collectUsage([
    usageLine("r1", "1", {
      input_tokens: "10",
      output_tokens: "5",
      total_tokens: "15",
      cost_usd: "0.25",
      context_percent: "12",
    }),
  ]);

  it("renders a terminal table with totals", () => {
    const text = formatUsage(usage, "terminal");
    expect(text).toContain("## Usage");
    expect(text).toContain("cost_usd");
    expect(text).toContain("0.2500");
    expect(text).toContain("totals: 1 iteration(s), 15 tokens, $0.2500");
  });

  it("renders JSON when asked", () => {
    const parsed = JSON.parse(formatUsage(usage, "json"));
    expect(parsed.totals.costUsd).toBeCloseTo(0.25, 6);
    expect(parsed.rows[0].contextPercent).toBe(12);
  });

  it("explains when no telemetry exists", () => {
    const text = formatUsage(collectUsage([]), "terminal");
    expect(text).toContain("No backend usage telemetry");
  });
});
