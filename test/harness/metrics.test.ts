import { encodeEvent } from "@mobrienv/autoloop-core";
import { describe, expect, it } from "vitest";
import { collectMetricsRows } from "../../src/harness/metrics.js";

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
});
