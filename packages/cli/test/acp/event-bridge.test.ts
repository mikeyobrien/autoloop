import type { LoopEvent } from "@mobrienv/autoloop-harness/events";
import { describe, expect, it } from "vitest";
import {
  type AcpSessionUpdate,
  EventBridge,
  type SessionUpdateSink,
} from "../../src/acp/event-bridge.js";

function makeSink(): { sink: SessionUpdateSink; updates: AcpSessionUpdate[] } {
  const updates: AcpSessionUpdate[] = [];
  return {
    updates,
    sink: { update: (u) => void updates.push(u) },
  };
}

async function feed(bridge: EventBridge, events: LoopEvent[]): Promise<void> {
  for (const e of events) await bridge.handle(e);
}

describe("EventBridge", () => {
  it("emits a tool_call on first iteration and updates thereafter", async () => {
    const { sink, updates } = makeSink();
    const bridge = new EventBridge(sink, "tc-1");
    await feed(bridge, [
      { type: "iteration.start", iteration: 1, maxIterations: 5, runId: "r1" },
      { type: "iteration.start", iteration: 2, maxIterations: 5, runId: "r1" },
    ]);
    expect(updates[0]).toMatchObject({
      sessionUpdate: "tool_call",
      toolCallId: "tc-1",
      kind: "execute",
      status: "in_progress",
      title: "Iteration 1/5",
    });
    expect(updates[1]).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-1",
      title: "Iteration 2/5",
    });
  });

  it("streams progress as tool content", async () => {
    const { sink, updates } = makeSink();
    const bridge = new EventBridge(sink, "tc");
    await feed(bridge, [
      { type: "iteration.start", iteration: 1, maxIterations: 3, runId: "r" },
      {
        type: "progress",
        runId: "r",
        iteration: 1,
        recentEvent: "plan.created",
        allowedRoles: ["planner"],
        emittedTopic: "plan.created",
        outcome: "continue",
      },
    ]);
    const content = updates.find(
      (u) =>
        u.sessionUpdate === "tool_call_update" && "content" in u && u.content,
    );
    expect(JSON.stringify(content)).toContain("plan.created");
    expect(JSON.stringify(content)).toContain("emitted: plan.created");
  });

  it("emits backend output as agent message chunks", async () => {
    const { sink, updates } = makeSink();
    const bridge = new EventBridge(sink, "tc");
    await bridge.handle({ type: "backend.output", output: "model said hi" });
    expect(updates[0]).toMatchObject({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "model said hi" },
    });
  });

  it("ignores blank backend output", async () => {
    const { sink, updates } = makeSink();
    const bridge = new EventBridge(sink, "tc");
    await bridge.handle({ type: "backend.output", output: "   " });
    expect(updates).toHaveLength(0);
  });

  it("surfaces logs as thoughts only when verbose", async () => {
    const quiet = makeSink();
    const qb = new EventBridge(quiet.sink, "tc");
    await qb.handle({ type: "log", level: "debug", message: "noise" });
    expect(quiet.updates).toHaveLength(0);

    const loud = makeSink();
    const lb = new EventBridge(loud.sink, "tc", { verbose: true });
    await lb.handle({ type: "log", level: "debug", message: "noise" });
    expect(loud.updates[0]).toMatchObject({
      sessionUpdate: "agent_thought_chunk",
    });
  });

  it("marks failure and completes the tool call as failed", async () => {
    const { sink, updates } = makeSink();
    const bridge = new EventBridge(sink, "tc");
    await feed(bridge, [
      { type: "iteration.start", iteration: 1, maxIterations: 1, runId: "r" },
      {
        type: "failure.diagnostic",
        output: "stack trace",
        stopReason: "error",
      },
      { type: "loop.finish", iterations: 1, stopReason: "error", runId: "r" },
    ]);
    const finalUpdate = updates[updates.length - 1];
    expect(finalUpdate).toMatchObject({
      sessionUpdate: "tool_call_update",
      status: "failed",
    });
    expect(bridge.result().stopReason).toBe("end_turn");
    expect(bridge.result().summary).toContain("failed");
  });

  it("completes successfully and reports iteration count", async () => {
    const { sink } = makeSink();
    const bridge = new EventBridge(sink, "tc");
    await feed(bridge, [
      { type: "iteration.start", iteration: 1, maxIterations: 2, runId: "r9" },
      {
        type: "loop.finish",
        iterations: 2,
        stopReason: "promise_met",
        runId: "r9",
      },
    ]);
    const result = bridge.result();
    expect(result.stopReason).toBe("end_turn");
    expect(result.iterations).toBe(2);
    expect(result.runId).toBe("r9");
    expect(result.summary).toContain("completed after 2 iterations");
  });

  it("singular iteration wording", async () => {
    const { sink } = makeSink();
    const bridge = new EventBridge(sink, "tc");
    await bridge.handle({
      type: "loop.finish",
      iterations: 1,
      stopReason: "done",
      runId: "r",
    });
    expect(bridge.result().summary).toContain("1 iteration ");
  });

  it("treats cancelled stop reasons as cancelled", async () => {
    const { sink } = makeSink();
    const bridge = new EventBridge(sink, "tc");
    await bridge.handle({
      type: "loop.finish",
      iterations: 1,
      stopReason: "cancelled by signal",
      runId: "r",
    });
    expect(bridge.result().stopReason).toBe("cancelled");
  });

  it("markCancelled forces cancelled outcome", async () => {
    const { sink, updates } = makeSink();
    const bridge = new EventBridge(sink, "tc");
    bridge.markCancelled();
    await bridge.handle({
      type: "loop.finish",
      iterations: 0,
      stopReason: "end_turn",
      runId: "r",
    });
    expect(bridge.result().stopReason).toBe("cancelled");
    // finish before any iteration banner still emits a tool_call then failed update
    expect(updates[0]).toMatchObject({ sessionUpdate: "tool_call" });
  });

  it("ignores display-only events", async () => {
    const { sink, updates } = makeSink();
    const bridge = new EventBridge(sink, "tc");
    await bridge.handle({
      type: "iteration.footer",
      iteration: 1,
      elapsedS: 2,
    });
    expect(updates).toHaveLength(0);
  });
});
