import { resolve } from "node:path";
import type { LoopEvent } from "@mobrienv/autoloop-harness/events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AcpSessionUpdate,
  SessionUpdateSink,
} from "../../src/acp/event-bridge.js";

type RunOpts = { onEvent: (e: LoopEvent) => void; workDir?: string };

const bundleRoot = resolve(import.meta.dirname, "../..");

// Mock the harness run + chain runner so we control the emitted event stream.
const runMock = vi.fn();
vi.mock("@mobrienv/autoloop-harness", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, run: (...args: unknown[]) => runMock(...args) };
});

const runChainMock = vi.fn();
vi.mock("../../src/chains.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    runChain: (...args: unknown[]) => runChainMock(...args),
    parseInlineChain: () => ({ name: "inline", steps: [] }),
  };
});

// Import after mocks are registered.
const { executeRun } = await import("../../src/acp/run-exec.js");

function makeSink(): { sink: SessionUpdateSink; updates: AcpSessionUpdate[] } {
  const updates: AcpSessionUpdate[] = [];
  return { updates, sink: { update: (u) => void updates.push(u) } };
}

function emitInto(onEvent: (e: LoopEvent) => void, events: LoopEvent[]): void {
  for (const e of events) onEvent(e);
}

afterEach(() => {
  runMock.mockReset();
  runChainMock.mockReset();
});

describe("executeRun", () => {
  it("streams a run's events and resolves end_turn", async () => {
    let capturedWorkDir: string | undefined;
    runMock.mockImplementation(
      async (_dir: string, _prompt: unknown, _self: string, opts: RunOpts) => {
        capturedWorkDir = opts.workDir;
        emitInto(opts.onEvent, [
          {
            type: "iteration.start",
            iteration: 1,
            maxIterations: 1,
            runId: "r1",
          },
          { type: "backend.output", output: "did work" },
          {
            type: "loop.finish",
            iterations: 1,
            stopReason: "promise_met",
            runId: "r1",
          },
        ]);
        return { iterations: 1, stopReason: "promise_met", runId: "r1" };
      },
    );
    const { sink, updates } = makeSink();
    const ctrl = new AbortController();
    const result = await executeRun("run", ["autocode", "do it"], {
      bundleRoot,
      selfCmd: "autoloop",
      projectDir: "/tmp/acp-proj",
      signal: ctrl.signal,
      sink,
      toolCallId: "tc-run",
    });
    expect(runMock).toHaveBeenCalledOnce();
    expect(capturedWorkDir).toBe("/tmp/acp-proj");
    expect(result.stopReason).toBe("end_turn");
    expect(result.summary).toContain("completed");
    expect(updates.some((u) => u.sessionUpdate === "tool_call")).toBe(true);
    expect(updates.some((u) => u.sessionUpdate === "agent_message_chunk")).toBe(
      true,
    );
  });

  it("returns a usage error for invalid run args", async () => {
    const { sink } = makeSink();
    const result = await executeRun("run", ["does-not-exist-preset-xyz"], {
      bundleRoot,
      selfCmd: "autoloop",
      projectDir: "/tmp/acp-proj",
      signal: new AbortController().signal,
      sink,
      toolCallId: "tc",
    });
    expect(result.usageError).toBe(true);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("marks the turn cancelled when the signal aborts", async () => {
    runMock.mockImplementation(
      async (_dir: string, _p: unknown, _s: string, opts: RunOpts) => {
        opts.onEvent({
          type: "iteration.start",
          iteration: 1,
          maxIterations: 5,
          runId: "r",
        });
        // simulate client cancel mid-run
        ctrl.abort();
        opts.onEvent({
          type: "loop.finish",
          iterations: 1,
          stopReason: "end_turn",
          runId: "r",
        });
        return { iterations: 1, stopReason: "end_turn", runId: "r" };
      },
    );
    const ctrl = new AbortController();
    const { sink } = makeSink();
    const result = await executeRun("run", ["autocode"], {
      bundleRoot,
      selfCmd: "autoloop",
      projectDir: "/tmp/acp-proj",
      signal: ctrl.signal,
      sink,
      toolCallId: "tc",
    });
    expect(result.stopReason).toBe("cancelled");
  });

  it("routes --automerge through a chain", async () => {
    runChainMock.mockImplementation(
      async (_spec: unknown, _dir: string, _self: string, opts: RunOpts) => {
        opts.onEvent({
          type: "loop.finish",
          iterations: 2,
          stopReason: "promise_met",
          runId: "rc",
        });
        return { completed: [], outcome: "success" };
      },
    );
    const { sink } = makeSink();
    const result = await executeRun("run", ["autocode", "--automerge", "go"], {
      bundleRoot,
      selfCmd: "autoloop",
      projectDir: "/tmp/acp-proj",
      signal: new AbortController().signal,
      sink,
      toolCallId: "tc",
    });
    expect(runChainMock).toHaveBeenCalledOnce();
    expect(result.stopReason).toBe("end_turn");
  });

  it("routes inline --chain through a chain", async () => {
    runChainMock.mockResolvedValue({ completed: [], outcome: "success" });
    const { sink } = makeSink();
    await executeRun("run", ["--chain", "autocode,autoqa", "build"], {
      bundleRoot,
      selfCmd: "autoloop",
      projectDir: "/tmp/acp-proj",
      signal: new AbortController().signal,
      sink,
      toolCallId: "tc",
    });
    expect(runChainMock).toHaveBeenCalledOnce();
  });

  it("chain verb prints usage for list", async () => {
    const { sink } = makeSink();
    const result = await executeRun("chain", ["list"], {
      bundleRoot,
      selfCmd: "autoloop",
      projectDir: "/tmp/acp-proj",
      signal: new AbortController().signal,
      sink,
      toolCallId: "tc",
    });
    expect(result.summary).toContain("Known presets");
  });

  it("chain run executes an inline chain", async () => {
    runChainMock.mockResolvedValue({ completed: [], outcome: "success" });
    const { sink } = makeSink();
    const result = await executeRun("chain", ["run", "autocode,autoqa", "x"], {
      bundleRoot,
      selfCmd: "autoloop",
      projectDir: "/tmp/acp-proj",
      signal: new AbortController().signal,
      sink,
      toolCallId: "tc",
    });
    expect(runChainMock).toHaveBeenCalledOnce();
    expect(result.stopReason).toBe("end_turn");
  });

  it("chain run without a csv prints usage", async () => {
    const { sink } = makeSink();
    const result = await executeRun("chain", ["run"], {
      bundleRoot,
      selfCmd: "autoloop",
      projectDir: "/tmp/acp-proj",
      signal: new AbortController().signal,
      sink,
      toolCallId: "tc",
    });
    expect(result.summary).toContain("Usage: chain run");
    expect(runChainMock).not.toHaveBeenCalled();
  });

  it("unknown chain subcommand is reported", async () => {
    const { sink } = makeSink();
    const result = await executeRun("chain", ["bogus"], {
      bundleRoot,
      selfCmd: "autoloop",
      projectDir: "/tmp/acp-proj",
      signal: new AbortController().signal,
      sink,
      toolCallId: "tc",
    });
    expect(result.summary).toContain("Unknown chain subcommand");
  });
});
