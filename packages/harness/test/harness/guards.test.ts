import { encodeEvent } from "@mobrienv/autoloop-core";
import {
  checkCostBudget,
  checkRuntimeBudget,
  detectStall,
  loopStartMs,
} from "@mobrienv/autoloop-harness/guards";
import { describe, expect, it } from "vitest";

function finishLine(iteration: string, output: string): string {
  return encodeEvent({
    shape: "fields",
    run: "r1",
    iteration,
    topic: "iteration.finish",
    fields: { exit_code: "0", timed_out: "false", output },
  });
}

function usageLine(iteration: string, costUsd: string): string {
  return encodeEvent({
    shape: "fields",
    run: "r1",
    iteration,
    topic: "backend.usage",
    fields: { cost_usd: costUsd, total_tokens: "100" },
  });
}

function startLine(createdAt: string): string {
  return encodeEvent({
    shape: "fields",
    run: "r1",
    iteration: "",
    topic: "loop.start",
    fields: { max_iterations: "3", created_at: createdAt },
  });
}

describe("detectStall", () => {
  it("is disabled when threshold is zero", () => {
    const lines = [finishLine("1", "same"), finishLine("2", "same")];
    expect(detectStall(lines, 0)).toEqual({ stalled: false, repeats: 0 });
  });

  it("does not stall while outputs differ", () => {
    const lines = [
      finishLine("1", "working on step 1"),
      finishLine("2", "working on step 2"),
      finishLine("3", "working on step 1"),
    ];
    const check = detectStall(lines, 2);
    expect(check.stalled).toBe(false);
    expect(check.repeats).toBe(1);
  });

  it("stalls after N consecutive identical outputs", () => {
    const lines = [
      finishLine("1", "different"),
      finishLine("2", "I cannot proceed."),
      finishLine("3", "I cannot proceed."),
      finishLine("4", "I cannot proceed."),
    ];
    const check = detectStall(lines, 3);
    expect(check.stalled).toBe(true);
    expect(check.repeats).toBe(3);
  });

  it("ignores leading whitespace differences", () => {
    const lines = [finishLine("1", "  stuck "), finishLine("2", "stuck")];
    expect(detectStall(lines, 2).stalled).toBe(true);
  });

  it("never stalls on empty outputs", () => {
    const lines = [
      finishLine("1", ""),
      finishLine("2", ""),
      finishLine("3", ""),
    ];
    expect(detectStall(lines, 2).stalled).toBe(false);
  });

  it("handles journals with no iteration.finish events", () => {
    expect(detectStall(["not json"], 2)).toEqual({
      stalled: false,
      repeats: 0,
    });
  });
});

describe("checkCostBudget", () => {
  it("is disabled when budget is zero", () => {
    const lines = [usageLine("1", "5.00")];
    expect(checkCostBudget(lines, 0)).toEqual({ exceeded: false, costUsd: 0 });
  });

  it("stays under budget while cost accumulates", () => {
    const lines = [usageLine("1", "0.30"), usageLine("2", "0.30")];
    const check = checkCostBudget(lines, 1.0);
    expect(check.exceeded).toBe(false);
    expect(check.costUsd).toBeCloseTo(0.6, 6);
  });

  it("trips once accumulated cost reaches the budget", () => {
    const lines = [
      usageLine("1", "0.50"),
      usageLine("2", "0.30"),
      usageLine("3", "0.25"),
    ];
    const check = checkCostBudget(lines, 1.0);
    expect(check.exceeded).toBe(true);
    expect(check.costUsd).toBeCloseTo(1.05, 6);
  });

  it("never trips for backends without usage telemetry", () => {
    const lines = [finishLine("1", "output only")];
    expect(checkCostBudget(lines, 0.01).exceeded).toBe(false);
  });
});

describe("loopStartMs", () => {
  it("extracts the start time from loop.start created_at", () => {
    const lines = [startLine("2026-06-12T10:00:00.000Z"), finishLine("1", "x")];
    expect(loopStartMs(lines)).toBe(Date.parse("2026-06-12T10:00:00.000Z"));
  });

  it("returns null when no loop.start event exists", () => {
    expect(loopStartMs([finishLine("1", "x")])).toBeNull();
    expect(loopStartMs(["not json"])).toBeNull();
  });

  it("returns null when created_at is unparseable", () => {
    expect(loopStartMs([startLine("yesterday-ish")])).toBeNull();
    expect(loopStartMs([startLine("")])).toBeNull();
  });
});

describe("checkRuntimeBudget", () => {
  const startIso = "2026-06-12T10:00:00.000Z";
  const startMs = Date.parse(startIso);

  it("is disabled when the budget is zero", () => {
    const lines = [startLine(startIso)];
    expect(checkRuntimeBudget(lines, 0, startMs + 999_999)).toEqual({
      exceeded: false,
      elapsedMs: 0,
    });
  });

  it("stays under budget while elapsed time is short", () => {
    const lines = [startLine(startIso)];
    const check = checkRuntimeBudget(lines, 60_000, startMs + 30_000);
    expect(check.exceeded).toBe(false);
    expect(check.elapsedMs).toBe(30_000);
  });

  it("trips once elapsed time reaches the budget", () => {
    const lines = [startLine(startIso)];
    expect(checkRuntimeBudget(lines, 60_000, startMs + 60_000).exceeded).toBe(
      true,
    );
    expect(checkRuntimeBudget(lines, 60_000, startMs + 90_000)).toEqual({
      exceeded: true,
      elapsedMs: 90_000,
    });
  });

  it("is disabled when the journal has no start time", () => {
    const lines = [finishLine("1", "x")];
    expect(checkRuntimeBudget(lines, 60_000, startMs + 90_000).exceeded).toBe(
      false,
    );
  });
});
