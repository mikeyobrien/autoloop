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
      title: "run r1 · iter 1/5",
    });
    // iteration 1 was silent, so a status note precedes the iter 2 title update.
    const titleUpdate = updates.find(
      (u) =>
        u.sessionUpdate === "tool_call_update" &&
        "title" in u &&
        u.title === "run r1 · iter 2/5",
    );
    expect(titleUpdate).toBeTruthy();
  });

  it("opens the tool call named after the run id and emits a header on loop.start", async () => {
    const { sink, updates } = makeSink();
    const bridge = new EventBridge(sink, "tc-h");
    await feed(bridge, [
      {
        type: "loop.start",
        runId: "brave-otter",
        prompt: "Fix the login bug",
        workDir: "/home/me/project",
        projectDir: "/presets/autocode",
        preset: "autocode",
        backend: "kiro",
        maxIterations: 100,
        completionEvent: "task.complete",
        completionPromise: "LOOP_COMPLETE",
      },
      {
        type: "iteration.start",
        iteration: 1,
        maxIterations: 100,
        runId: "brave-otter",
      },
    ]);
    // First update opens the tool call titled by preset + run id (no iter yet).
    expect(updates[0]).toMatchObject({
      sessionUpdate: "tool_call",
      toolCallId: "tc-h",
      kind: "execute",
      status: "in_progress",
      title: "autocode · run brave-otter",
    });
    // Header message carries the key parameters.
    const header = updates[1];
    expect(header).toMatchObject({ sessionUpdate: "agent_message_chunk" });
    const text =
      header.sessionUpdate === "agent_message_chunk" ? header.content.text : "";
    expect(text).toContain("brave-otter");
    expect(text).toContain("autocode");
    expect(text).toContain("kiro");
    expect(text).toContain("/home/me/project");
    expect(text).toContain("max 100");
    expect(text).toContain("task.complete");
    expect(text).toContain("LOOP_COMPLETE");
    expect(text).toContain("Fix the login bug");
    // iteration.start then updates the title to include the counter.
    expect(updates[2]).toMatchObject({
      sessionUpdate: "tool_call_update",
      title: "autocode · run brave-otter · iter 1/100",
    });
  });

  it("omits optional completion/objective lines when absent", async () => {
    const { sink, updates } = makeSink();
    const bridge = new EventBridge(sink, "tc-min");
    await bridge.handle({
      type: "loop.start",
      runId: "calm-finch",
      prompt: "   ",
      workDir: "/w",
      projectDir: "/p",
      preset: "autoqa",
      backend: "claude",
      maxIterations: 10,
      completionEvent: "",
      completionPromise: "",
    });
    const header = updates[1];
    const text =
      header.sessionUpdate === "agent_message_chunk" ? header.content.text : "";
    expect(text).toContain("calm-finch");
    expect(text).not.toContain("completion:");
    expect(text).not.toContain("objective:");
  });

  it("updates the title when loop.start arrives after the tool call opened", async () => {
    const { sink, updates } = makeSink();
    const bridge = new EventBridge(sink, "tc-late");
    // iteration.start opens the tool call first, then a loop.start updates the
    // title rather than re-opening.
    await feed(bridge, [
      { type: "iteration.start", iteration: 1, maxIterations: 3, runId: "r2" },
      {
        type: "loop.start",
        runId: "r2",
        prompt: "x",
        workDir: "/w",
        projectDir: "/p",
        preset: "autocode",
        backend: "kiro",
        maxIterations: 3,
        completionEvent: "task.complete",
        completionPromise: "",
      },
    ]);
    const titleUpdate = updates.find(
      (u) =>
        u.sessionUpdate === "tool_call_update" &&
        "title" in u &&
        u.title?.includes("run r2"),
    );
    expect(titleUpdate).toBeTruthy();
    // After loop.start the preset prefixes the title.
    const titled = updates.find(
      (u) =>
        u.sessionUpdate === "tool_call_update" &&
        "title" in u &&
        u.title?.startsWith("autocode · run r2"),
    );
    expect(titled).toBeTruthy();
  });

  it("streams progress as an assistant message", async () => {
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
    // The iteration update is a top-level assistant message (priority message),
    // not collapsed tool-call content and not an agent thought.
    const msg = updates.find(
      (u) =>
        u.sessionUpdate === "agent_message_chunk" &&
        u.content.text.includes("plan.created"),
    );
    expect(msg).toBeTruthy();
    const text =
      msg?.sessionUpdate === "agent_message_chunk" ? msg.content.text : "";
    expect(text).toContain("iteration 1");
    expect(text).toContain("event: plan.created");
    expect(text).toContain("outcome: continue");
    expect(text).toContain("emitted: plan.created");
    // It must NOT be routed as tool-call content.
    const toolContent = updates.find(
      (u) =>
        u.sessionUpdate === "tool_call_update" && "content" in u && u.content,
    );
    expect(toolContent).toBeUndefined();
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

  it("surfaces a progress-only iteration as an assistant message (no silent note)", async () => {
    const { sink, updates } = makeSink();
    const bridge = new EventBridge(sink, "tc");
    await feed(bridge, [
      { type: "iteration.start", iteration: 1, maxIterations: 5, runId: "r" },
      // iteration 1 emits a routing event but no backend output — the progress
      // update itself is now the assistant message for the iteration.
      {
        type: "progress",
        runId: "r",
        iteration: 1,
        recentEvent: "loop.start",
        allowedRoles: ["planner"],
        emittedTopic: "tasks.ready",
        outcome: "continue:routed_event",
      },
      { type: "iteration.start", iteration: 2, maxIterations: 5, runId: "r" },
    ]);
    // The progress line is surfaced as a priority assistant message.
    const progressMsg = updates.find(
      (u) =>
        u.sessionUpdate === "agent_message_chunk" &&
        u.content.text.includes("tasks.ready"),
    );
    expect(progressMsg).toBeTruthy();
    const text =
      progressMsg?.sessionUpdate === "agent_message_chunk"
        ? progressMsg.content.text
        : "";
    expect(text).toContain("iteration 1");
    expect(text).toContain("continue:routed_event");
    // Because the iteration produced a real message, the "no message output"
    // fallback note must NOT fire.
    const note = updates.find(
      (u) =>
        u.sessionUpdate === "agent_message_chunk" &&
        u.content.text.includes("produced no message output"),
    );
    expect(note).toBeUndefined();
  });

  it("emits a status chunk for a silent final iteration on loop.finish", async () => {
    const { sink, updates } = makeSink();
    const bridge = new EventBridge(sink, "tc");
    await feed(bridge, [
      { type: "iteration.start", iteration: 1, maxIterations: 1, runId: "r" },
      { type: "loop.finish", iterations: 1, stopReason: "done", runId: "r" },
    ]);
    const note = updates.find(
      (u) =>
        u.sessionUpdate === "agent_message_chunk" &&
        u.content.text.includes("produced no message output"),
    );
    expect(note).toBeTruthy();
    const text =
      note?.sessionUpdate === "agent_message_chunk" ? note.content.text : "";
    // No progress was recorded, so the note falls back to "no event emitted".
    expect(text).toContain("no event emitted");
  });

  it("does not emit a status chunk when the iteration produced output", async () => {
    const { sink, updates } = makeSink();
    const bridge = new EventBridge(sink, "tc");
    await feed(bridge, [
      { type: "iteration.start", iteration: 1, maxIterations: 2, runId: "r" },
      { type: "backend.output", output: "did real work" },
      { type: "iteration.start", iteration: 2, maxIterations: 2, runId: "r" },
    ]);
    const note = updates.find(
      (u) =>
        u.sessionUpdate === "agent_message_chunk" &&
        u.content.text.includes("produced no message output"),
    );
    expect(note).toBeUndefined();
  });

  it("surfaces debug logs as thoughts only when verbose", async () => {
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

  it("surfaces info logs as assistant messages regardless of verbose", async () => {
    const { sink, updates } = makeSink();
    const bridge = new EventBridge(sink, "tc");
    await bridge.handle({
      type: "log",
      level: "info",
      message: "worktree cleaned for run r1",
    });
    expect(updates[0]).toMatchObject({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "worktree cleaned for run r1" },
    });
  });

  it("prefixes warn and error logs with their level", async () => {
    const { sink, updates } = makeSink();
    const bridge = new EventBridge(sink, "tc");
    await feed(bridge, [
      {
        type: "log",
        level: "warn",
        message: "worktree merge failed: conflict",
      },
      {
        type: "log",
        level: "error",
        message: "loop stop reason=backend_failed",
      },
    ]);
    expect(updates[0]).toMatchObject({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "[warn] worktree merge failed: conflict" },
    });
    expect(updates[1]).toMatchObject({
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: "[error] loop stop reason=backend_failed",
      },
    });
  });

  it("suppresses the internal loop-start info log (header replaces it)", async () => {
    const { sink, updates } = makeSink();
    const bridge = new EventBridge(sink, "tc");
    await bridge.handle({
      type: "log",
      level: "info",
      message: "loop start run_id=brave-otter max_iterations=100",
    });
    expect(updates).toHaveLength(0);
  });

  it("ignores blank log messages", async () => {
    const { sink, updates } = makeSink();
    const bridge = new EventBridge(sink, "tc", { verbose: true });
    await bridge.handle({ type: "log", level: "info", message: "   " });
    expect(updates).toHaveLength(0);
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
