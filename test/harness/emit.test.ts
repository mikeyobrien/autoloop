import { describe, expect, it } from "vitest";
import {
  coordinationTopic,
  coreSystemTopic,
  dispatchParallelJoinBase,
  dispatchParallelJoinedTopic,
  invalidEvent,
  parallelDispatchBase,
  parallelJoinedTopic,
  parallelTopic,
  parallelTriggerTopic,
  reservedParallelJoinedTopic,
  routingTopic,
  systemTopic,
} from "../../src/harness/emit.js";

describe("coordinationTopic", () => {
  it("recognizes coordination topics", () => {
    expect(coordinationTopic("issue.discovered")).toBe(true);
    expect(coordinationTopic("slice.started")).toBe(true);
    expect(coordinationTopic("chain.spawn")).toBe(true);
  });

  it("rejects non-coordination topics", () => {
    expect(coordinationTopic("task.complete")).toBe(false);
    expect(coordinationTopic("loop.start")).toBe(false);
    expect(coordinationTopic("")).toBe(false);
  });
});

describe("coreSystemTopic", () => {
  it("recognizes core system topics", () => {
    expect(coreSystemTopic("iteration.start")).toBe(true);
    expect(coreSystemTopic("loop.complete")).toBe(true);
    expect(coreSystemTopic("backend.finish")).toBe(true);
    expect(coreSystemTopic("event.invalid")).toBe(true);
  });

  it("recognizes wave.* as core system", () => {
    expect(coreSystemTopic("wave.dispatch")).toBe(true);
    expect(coreSystemTopic("wave.join.finish")).toBe(true);
  });

  it("rejects non-system topics", () => {
    expect(coreSystemTopic("task.complete")).toBe(false);
    expect(coreSystemTopic("gaps.identified")).toBe(false);
  });
});

describe("systemTopic", () => {
  it("includes both coordination and core system topics", () => {
    expect(systemTopic("issue.discovered")).toBe(true);
    expect(systemTopic("iteration.start")).toBe(true);
    expect(systemTopic("wave.dispatch")).toBe(true);
  });

  it("rejects user topics", () => {
    expect(systemTopic("task.complete")).toBe(false);
  });
});

describe("parallelTopic", () => {
  it("recognizes explore.parallel", () => {
    expect(parallelTopic("explore.parallel")).toBe(true);
  });

  it("recognizes dispatch parallel topics", () => {
    expect(parallelTopic("tests.written.parallel")).toBe(true);
  });

  it("recognizes joined parallel topics", () => {
    expect(parallelTopic("tests.written.parallel.joined")).toBe(true);
  });

  it("rejects normal topics", () => {
    expect(parallelTopic("task.complete")).toBe(false);
  });
});

describe("parallelTriggerTopic", () => {
  it("explore.parallel is a trigger", () => {
    expect(parallelTriggerTopic("explore.parallel")).toBe(true);
  });

  it("dispatch .parallel topics are triggers", () => {
    expect(parallelTriggerTopic("foo.parallel")).toBe(true);
  });

  it("joined topics are not triggers", () => {
    expect(parallelTriggerTopic("foo.parallel.joined")).toBe(false);
  });
});

describe("reservedParallelJoinedTopic", () => {
  it("matches .parallel.joined suffix", () => {
    expect(reservedParallelJoinedTopic("tests.written.parallel.joined")).toBe(
      true,
    );
    expect(reservedParallelJoinedTopic("explore.parallel.joined")).toBe(true);
  });

  it("rejects non-joined topics", () => {
    expect(reservedParallelJoinedTopic("tests.written.parallel")).toBe(false);
    expect(reservedParallelJoinedTopic("task.complete")).toBe(false);
  });
});

describe("parallelDispatchBase", () => {
  it("strips .parallel suffix for dispatch topics", () => {
    expect(parallelDispatchBase("tests.written.parallel")).toBe(
      "tests.written",
    );
  });

  it("returns empty for explore.parallel (not a dispatch topic)", () => {
    expect(parallelDispatchBase("explore.parallel")).toBe("");
  });

  it("returns empty for non-parallel topics", () => {
    expect(parallelDispatchBase("task.complete")).toBe("");
  });
});

describe("parallelJoinedTopic", () => {
  it("appends .joined", () => {
    expect(parallelJoinedTopic("tests.written.parallel")).toBe(
      "tests.written.parallel.joined",
    );
  });
});

describe("dispatchParallelJoinedTopic", () => {
  it("returns true for dispatch joined topics", () => {
    expect(dispatchParallelJoinedTopic("tests.written.parallel.joined")).toBe(
      true,
    );
  });

  it("returns false for explore.parallel.joined (reserved)", () => {
    expect(dispatchParallelJoinedTopic("explore.parallel.joined")).toBe(false);
  });

  it("returns false for non-joined topics", () => {
    expect(dispatchParallelJoinedTopic("task.complete")).toBe(false);
  });
});

describe("dispatchParallelJoinBase", () => {
  it("returns loop.start for explore.parallel.joined", () => {
    expect(dispatchParallelJoinBase("explore.parallel.joined")).toBe(
      "loop.start",
    );
  });

  it("strips .parallel.joined for dispatch joined topics", () => {
    expect(dispatchParallelJoinBase("tests.written.parallel.joined")).toBe(
      "tests.written",
    );
  });

  it("returns topic unchanged for non-joined topics", () => {
    expect(dispatchParallelJoinBase("task.complete")).toBe("task.complete");
  });
});

describe("routingTopic", () => {
  it("user events are routing topics", () => {
    expect(routingTopic("task.complete")).toBe(true);
    expect(routingTopic("gaps.identified")).toBe(true);
  });

  it("iteration lifecycle is not routing", () => {
    expect(routingTopic("iteration.start")).toBe(false);
    expect(routingTopic("iteration.finish")).toBe(false);
  });

  it("backend events are not routing", () => {
    expect(routingTopic("backend.start")).toBe(false);
    expect(routingTopic("backend.finish")).toBe(false);
  });

  it("empty string is not routing", () => {
    expect(routingTopic("")).toBe(false);
  });

  it("coordination topics are not routing", () => {
    expect(routingTopic("issue.discovered")).toBe(false);
    expect(routingTopic("chain.spawn")).toBe(false);
  });

  it("loop.start is routing", () => {
    expect(routingTopic("loop.start")).toBe(true);
  });
});

describe("invalidEvent", () => {
  it("returns false for empty topic", () => {
    expect(invalidEvent("", ["task.complete"], false, "task.complete")).toBe(
      false,
    );
  });

  it("rejects reserved .parallel.joined topics always", () => {
    expect(
      invalidEvent("foo.parallel.joined", [], false, "task.complete"),
    ).toBe(true);
  });

  it("rejects parallel topics when parallel disabled", () => {
    expect(invalidEvent("foo.parallel", ["foo"], false, "task.complete")).toBe(
      true,
    );
    expect(
      invalidEvent("explore.parallel", ["foo"], false, "task.complete"),
    ).toBe(true);
  });

  it("allows any topic when allowedEvents is empty and parallel disabled", () => {
    expect(invalidEvent("anything", [], false, "task.complete")).toBe(false);
  });

  it("allows topic that matches allowedEvents", () => {
    expect(
      invalidEvent("task.complete", ["task.complete"], false, "task.complete"),
    ).toBe(false);
  });

  it("rejects topic not in allowedEvents", () => {
    expect(
      invalidEvent("foo.bar", ["task.complete"], false, "task.complete"),
    ).toBe(true);
  });

  it("allows explore.parallel when parallel enabled", () => {
    expect(
      invalidEvent(
        "explore.parallel",
        ["task.complete"],
        true,
        "task.complete",
      ),
    ).toBe(false);
  });

  it("rejects dispatch parallel for completion event", () => {
    expect(
      invalidEvent(
        "task.complete.parallel",
        ["task.complete"],
        true,
        "task.complete",
      ),
    ).toBe(true);
  });

  it("allows dispatch parallel for allowed non-completion event", () => {
    expect(
      invalidEvent(
        "gaps.identified.parallel",
        ["gaps.identified", "task.complete"],
        true,
        "task.complete",
      ),
    ).toBe(false);
  });

  it("rejects dispatch parallel for system topic base", () => {
    expect(
      invalidEvent(
        "iteration.start.parallel",
        ["iteration.start"],
        true,
        "task.complete",
      ),
    ).toBe(true);
  });
});
