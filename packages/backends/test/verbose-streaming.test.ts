import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { formatStreamingUpdate } from "@mobrienv/autoloop-backends/acp-client";
import { describe, expect, it } from "vitest";

function chunk(sessionUpdate: string, text: string): SessionUpdate {
  return { sessionUpdate, content: { type: "text", text } } as SessionUpdate;
}

describe("formatStreamingUpdate", () => {
  it("returns raw text for agent_message_chunk", () => {
    expect(formatStreamingUpdate(chunk("agent_message_chunk", "hello"))).toBe(
      "hello",
    );
  });

  it("returns null for agent_message_chunk with non-text content", () => {
    const update = {
      sessionUpdate: "agent_message_chunk",
      content: { type: "image" },
    } as SessionUpdate;
    expect(formatStreamingUpdate(update)).toBeNull();
  });

  it("returns [thinking] prefix for agent_thought_chunk", () => {
    expect(formatStreamingUpdate(chunk("agent_thought_chunk", "hmm"))).toBe(
      "[thinking] hmm\n",
    );
  });

  it("returns null for agent_thought_chunk with non-text content", () => {
    const update = {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "image" },
    } as SessionUpdate;
    expect(formatStreamingUpdate(update)).toBeNull();
  });

  it("returns [tool:kind] for tool_call", () => {
    const update = {
      sessionUpdate: "tool_call",
      kind: "read",
      title: "Reading src/main.ts",
      toolCallId: "1",
    } as SessionUpdate;
    expect(formatStreamingUpdate(update)).toBe(
      "[tool:read] Reading src/main.ts\n",
    );
  });

  it("defaults kind to other for tool_call without kind", () => {
    const update = {
      sessionUpdate: "tool_call",
      title: "Doing something",
      toolCallId: "1",
    } as SessionUpdate;
    expect(formatStreamingUpdate(update)).toBe(
      "[tool:other] Doing something\n",
    );
  });

  it("returns [tool:✓] for completed tool_call_update", () => {
    const update = {
      sessionUpdate: "tool_call_update",
      status: "completed",
      title: "Done",
      toolCallId: "1",
    } as SessionUpdate;
    expect(formatStreamingUpdate(update)).toBe("[tool:✓] Done\n");
  });

  it("returns [tool:✗] for failed tool_call_update", () => {
    const update = {
      sessionUpdate: "tool_call_update",
      status: "failed",
      title: "Oops",
      toolCallId: "1",
    } as SessionUpdate;
    expect(formatStreamingUpdate(update)).toBe("[tool:✗] Oops\n");
  });

  it("returns null for in_progress tool_call_update", () => {
    const update = {
      sessionUpdate: "tool_call_update",
      status: "in_progress",
      title: "Working",
      toolCallId: "1",
    } as SessionUpdate;
    expect(formatStreamingUpdate(update)).toBeNull();
  });

  it("returns null for pending tool_call_update", () => {
    const update = {
      sessionUpdate: "tool_call_update",
      status: "pending",
      title: "Queued",
      toolCallId: "1",
    } as SessionUpdate;
    expect(formatStreamingUpdate(update)).toBeNull();
  });

  it("returns null for unhandled sessionUpdate types", () => {
    const update = { sessionUpdate: "plan" } as SessionUpdate;
    expect(formatStreamingUpdate(update)).toBeNull();
  });

  it("handles tool_call_update with missing title", () => {
    const update = {
      sessionUpdate: "tool_call_update",
      status: "completed",
      toolCallId: "1",
    } as SessionUpdate;
    expect(formatStreamingUpdate(update)).toBe("[tool:✓] \n");
  });
});
