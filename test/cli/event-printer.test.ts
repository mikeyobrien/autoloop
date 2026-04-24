import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Unit test for cli/event-printer.ts — the bridge between the SDK event
 * stream and terminal output. Regression-coverage for the `as never` stubs
 * that adapt LoopEvent payloads to the display helpers' (loop, iter) calling
 * convention. If anyone adds a new field read in display.ts, these tests
 * should surface it as a silent undefined immediately.
 */

import { cliPrintEvent } from "../../src/cli/event-printer.js";

vi.mock("@mobrienv/autoloop-harness/display", () => ({
  printBackendOutputTail: vi.fn(),
  printFailureDiagnostic: vi.fn(),
  printIterationBanner: vi.fn(),
  printIterationFooter: vi.fn(),
  printProgressLine: vi.fn(),
  printReviewBanner: vi.fn(),
  printSummary: vi.fn(),
}));

import {
  printBackendOutputTail,
  printFailureDiagnostic,
  printIterationBanner,
  printIterationFooter,
  printProgressLine,
  printReviewBanner,
  printSummary,
} from "@mobrienv/autoloop-harness/display";

afterEach(() => vi.clearAllMocks());

describe("cliPrintEvent", () => {
  it("swallows log / iteration.start / loop.finish with no display output", () => {
    cliPrintEvent({ type: "log", level: "info", message: "hello" });
    cliPrintEvent({
      type: "iteration.start",
      iteration: 1,
      maxIterations: 3,
      runId: "r",
    });
    cliPrintEvent({
      type: "loop.finish",
      iterations: 2,
      stopReason: "completed",
      runId: "r",
    });
    expect(printIterationBanner).not.toHaveBeenCalled();
    expect(printSummary).not.toHaveBeenCalled();
    expect(printProgressLine).not.toHaveBeenCalled();
  });

  it("iteration.banner forwards maxIterations + iter fields", () => {
    cliPrintEvent({
      type: "iteration.banner",
      iteration: 2,
      maxIterations: 5,
      allowedRoles: ["builder"],
      recentEvent: "loop.start",
      allowedEvents: ["code.written"],
      lastRejected: "oops",
    });
    expect(printIterationBanner).toHaveBeenCalledTimes(1);
    const [loopStub, iterStub] = (
      printIterationBanner as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(loopStub.limits.maxIterations).toBe(5);
    expect(iterStub.iteration).toBe(2);
    expect(iterStub.allowedRoles).toEqual(["builder"]);
    expect(iterStub.recentEvent).toBe("loop.start");
    expect(iterStub.allowedEvents).toEqual(["code.written"]);
    expect(iterStub.lastRejected).toBe("oops");
  });

  it("iteration.banner defaults lastRejected to empty string", () => {
    cliPrintEvent({
      type: "iteration.banner",
      iteration: 1,
      maxIterations: 3,
      allowedRoles: [],
      recentEvent: "",
      allowedEvents: [],
    });
    const [, iterStub] = (
      printIterationBanner as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(iterStub.lastRejected).toBe("");
  });

  it("iteration.footer forwards iter.iteration + elapsedS", () => {
    cliPrintEvent({ type: "iteration.footer", iteration: 3, elapsedS: 42 });
    expect(printIterationFooter).toHaveBeenCalledTimes(1);
    const [iterStub, elapsed] = (
      printIterationFooter as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(iterStub.iteration).toBe(3);
    expect(elapsed).toBe(42);
  });

  it("progress forwards all fields to printProgressLine", () => {
    cliPrintEvent({
      type: "progress",
      runId: "run-1",
      iteration: 2,
      recentEvent: "loop.start",
      allowedRoles: ["builder"],
      emittedTopic: "code.written",
      outcome: "continue",
    });
    expect(printProgressLine).toHaveBeenCalledWith({
      runId: "run-1",
      iteration: 2,
      recentEvent: "loop.start",
      allowedRoles: ["builder"],
      emittedTopic: "code.written",
      outcome: "continue",
    });
  });

  it("review.banner forwards iteration number", () => {
    cliPrintEvent({ type: "review.banner", iteration: 4 });
    expect(printReviewBanner).toHaveBeenCalledWith(4);
  });

  it("backend.output forwards output + optional maxLines", () => {
    cliPrintEvent({
      type: "backend.output",
      output: "hello\nworld",
      maxLines: 50,
    });
    expect(printBackendOutputTail).toHaveBeenCalledWith("hello\nworld", 50);
  });

  it("failure.diagnostic forwards output + stopReason", () => {
    cliPrintEvent({
      type: "failure.diagnostic",
      output: "boom",
      stopReason: "backend_failed",
    });
    expect(printFailureDiagnostic).toHaveBeenCalledWith(
      "boom",
      "backend_failed",
    );
  });

  it("summary builds a LoopContext stub with all fields display.ts reads", () => {
    cliPrintEvent({
      type: "summary",
      runId: "r-9",
      iterations: 7,
      stopReason: "completed",
      journalFile: "/tmp/j.jsonl",
      memoryFile: "/tmp/m.jsonl",
      reviewEvery: 3,
      toolPath: "/usr/local/bin/autoloop",
    });
    expect(printSummary).toHaveBeenCalledTimes(1);
    const [summary, loopStub] = (
      printSummary as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(summary).toEqual({
      iterations: 7,
      stopReason: "completed",
      runId: "r-9",
    });
    expect(loopStub.runtime.runId).toBe("r-9");
    expect(loopStub.paths.journalFile).toBe("/tmp/j.jsonl");
    expect(loopStub.paths.memoryFile).toBe("/tmp/m.jsonl");
    expect(loopStub.paths.toolPath).toBe("/usr/local/bin/autoloop");
    expect(loopStub.review.every).toBe(3);
  });
});
