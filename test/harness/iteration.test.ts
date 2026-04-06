import { describe, expect, it } from "vitest";
import { resolveOutcome } from "../../src/harness/iteration.js";

const base = {
  emittedTopic: "",
  allTopics: [] as string[],
  hadInvalidEvents: false,
  output: "",
  completionEvent: "task.complete",
  requiredEvents: [] as string[],
  completionPromise: "",
};

describe("resolveOutcome", () => {
  it("returns complete_event when completion event and all required events are present", () => {
    const result = resolveOutcome({
      ...base,
      allTopics: ["step.done", "task.complete"],
      requiredEvents: ["step.done"],
    });
    expect(result).toEqual({
      action: "complete_event",
      outcome: "complete:completion_event",
    });
  });

  it("returns complete_event even without required events when list is empty", () => {
    const result = resolveOutcome({
      ...base,
      allTopics: ["task.complete"],
    });
    expect(result).toEqual({
      action: "complete_event",
      outcome: "complete:completion_event",
    });
  });

  it("does not complete via event when required events are missing", () => {
    const result = resolveOutcome({
      ...base,
      emittedTopic: "step.done",
      allTopics: ["step.done"],
      requiredEvents: ["verify.done"],
    });
    expect(result).toEqual({
      action: "continue_routed",
      outcome: "continue:routed_event",
    });
  });

  it("returns continue_routed for a non-completion accepted event", () => {
    const result = resolveOutcome({
      ...base,
      emittedTopic: "plan.ready",
      allTopics: ["plan.ready"],
    });
    expect(result).toEqual({
      action: "continue_routed",
      outcome: "continue:routed_event",
    });
  });

  it("returns complete_promise when output contains the promise string", () => {
    const result = resolveOutcome({
      ...base,
      output: "some output LOOP_COMPLETE more output",
      completionPromise: "LOOP_COMPLETE",
    });
    expect(result).toEqual({
      action: "complete_promise",
      outcome: "complete:completion_promise",
    });
  });

  it("does not complete via promise when there were invalid events", () => {
    const result = resolveOutcome({
      ...base,
      hadInvalidEvents: true,
      output: "LOOP_COMPLETE",
      completionPromise: "LOOP_COMPLETE",
    });
    expect(result).toEqual({ action: "continue", outcome: "continue" });
  });

  it("does not complete via promise when promise is empty string", () => {
    const result = resolveOutcome({
      ...base,
      output: "anything",
      completionPromise: "",
    });
    expect(result).toEqual({ action: "continue", outcome: "continue" });
  });

  it("returns continue as the default fallback", () => {
    const result = resolveOutcome(base);
    expect(result).toEqual({ action: "continue", outcome: "continue" });
  });

  it("prefers completion event over routed event and promise", () => {
    const result = resolveOutcome({
      ...base,
      emittedTopic: "task.complete",
      allTopics: ["task.complete"],
      output: "LOOP_COMPLETE",
      completionPromise: "LOOP_COMPLETE",
    });
    expect(result).toEqual({
      action: "complete_event",
      outcome: "complete:completion_event",
    });
  });

  it("prefers routed event over promise completion", () => {
    const result = resolveOutcome({
      ...base,
      emittedTopic: "plan.ready",
      allTopics: ["plan.ready"],
      output: "LOOP_COMPLETE",
      completionPromise: "LOOP_COMPLETE",
    });
    expect(result).toEqual({
      action: "continue_routed",
      outcome: "continue:routed_event",
    });
  });
});
