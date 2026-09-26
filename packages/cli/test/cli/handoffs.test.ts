import { describe, expect, it } from "vitest";
import { formatHandoffs, handoffsFromLines } from "../../src/cli/handoffs.js";

const RUN = "run-a";
const TS = "2026-09-26T10:00:00.000Z";
const UNKNOWN = { status: "unknown" };
const CANARY = "CANARY-SECRET-7f3a";

function fields(
  topic: string,
  iteration: string | undefined,
  values: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    run: RUN,
    iteration,
    topic,
    ts: TS,
    v: 1,
    fields: values,
    ...extra,
  });
}

function emit(topic: string, source: string, iteration = "1"): string {
  return JSON.stringify({
    run: RUN,
    iteration,
    topic,
    ts: TS,
    v: 1,
    payload: `${CANARY} payload`,
    source,
  });
}

function start(iteration: string, recent: string, roles: string): string {
  return fields("iteration.start", iteration, {
    recent_event: recent,
    suggested_roles: roles,
    allowed_events: "task.done,task.blocked",
    backpressure: "",
    prompt: `${CANARY} prompt`,
  });
}

function base(ordinal: number, iteration: string | null) {
  return {
    ordinal,
    iteration,
    timestamp: TS,
    actor_role: UNKNOWN,
    decision_maker: UNKNOWN,
  };
}

describe("handoffsFromLines", () => {
  it("projects each relevant record kind in journal order with unknown attribution", () => {
    const report = handoffsFromLines(RUN, [
      fields("loop.start", undefined, { max_iterations: "5" }),
      start("1", "loop.start", "planner,builder"),
      fields("backend.start", "1", { command: "pi", args: CANARY }),
      emit("task.done", "agent"),
      fields("event.invalid", "1", {
        recent_event: "loop.start",
        emitted: "task.bogus",
        suggested_roles: "planner",
        allowed_events: "task.done",
      }),
      fields("backend.transient", "1", {
        error_class: CANARY,
        pause_count: "2",
        backoff_ms: 4000,
        output_tail: CANARY,
      }),
      fields("backend.usage", "1", {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        total_tokens: 15,
        cost_usd: 0.25,
        context_percent: 40,
      }),
      fields("backend.finish", "1", {
        exit_code: "0",
        timed_out: false,
        output: CANARY,
      }),
      fields("iteration.finish", "1", {
        exit_code: "1",
        timed_out: "true",
        elapsed_s: "12.5",
        output: CANARY,
      }),
      fields("loop.stop", undefined, {
        reason: "max_iterations",
        detail: CANARY,
      }),
    ]);

    expect(report).toEqual({
      schema_version: 1,
      run_id: RUN,
      ordering: "journal_input",
      completeness: "not_established",
      observations: [
        {
          ...base(1, "1"),
          kind: "decision",
          recent_event: "loop.start",
          suggested_roles: ["planner", "builder"],
          allowed_events: ["task.done", "task.blocked"],
          backpressure_present: false,
        },
        {
          ...base(2, "1"),
          kind: "accepted",
          event: "task.done",
          source: "agent",
        },
        {
          ...base(3, "1"),
          kind: "validation",
          validation: "rejected",
          emitted: "task.bogus",
          recent_event: "loop.start",
          suggested_roles: ["planner"],
          allowed_events: ["task.done"],
        },
        { ...base(4, "1"), kind: "retry", pause_count: 2, backoff_ms: 4000 },
        {
          ...base(5, "1"),
          kind: "usage",
          input_tokens: 10,
          output_tokens: 5,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          total_tokens: 15,
          cost_usd: 0.25,
        },
        {
          ...base(6, "1"),
          kind: "finish",
          scope: "backend",
          exit_code: 0,
          timed_out: false,
          elapsed_s: null,
        },
        {
          ...base(7, "1"),
          kind: "finish",
          scope: "iteration",
          exit_code: 1,
          timed_out: true,
          elapsed_s: 12.5,
        },
        {
          ...base(8, null),
          kind: "terminal",
          event: "loop.stop",
          reason: "max_iterations",
        },
      ],
    });
    expect(JSON.stringify(report)).not.toContain(CANARY);
  });

  it("keeps duplicates and interleaved same-label parallel records as separate rows", () => {
    const report = handoffsFromLines(RUN, [
      start("2", "task.split", "a,b"),
      start("2", "task.split", "a,b"),
      emit("a.done", "agent", "2"),
      emit("b.done", "agent", "2"),
      emit("a.done", "agent", "2"),
    ]);
    expect(
      report.observations.map((row) => [row.ordinal, row.iteration, row.kind]),
    ).toEqual([
      [1, "2", "decision"],
      [2, "2", "decision"],
      [3, "2", "accepted"],
      [4, "2", "accepted"],
      [5, "2", "accepted"],
    ]);
    expect(
      report.observations.map((row) =>
        row.kind === "accepted" ? row.event : null,
      ),
    ).toEqual([null, null, "a.done", "b.done", "a.done"]);
  });

  it("preserves input order when timestamps run backwards or repeat", () => {
    const line = (ts: string, recent: string) =>
      fields("iteration.start", "1", { recent_event: recent }, { ts });
    const report = handoffsFromLines(RUN, [
      line("2026-09-26T10:00:05.000Z", "first"),
      line("2026-09-26T10:00:01.000Z", "second"),
      line("2026-09-26T10:00:01.000Z", "third"),
    ]);
    expect(
      report.observations.map((row) => [
        row.timestamp,
        row.kind === "decision" ? row.recent_event : null,
      ]),
    ).toEqual([
      ["2026-09-26T10:00:05.000Z", "first"],
      ["2026-09-26T10:00:01.000Z", "second"],
      ["2026-09-26T10:00:01.000Z", "third"],
    ]);
  });

  it("accepts only agent payload emits and never the completion lifecycle marker", () => {
    const report = handoffsFromLines(RUN, [
      emit("task.done", "harness"),
      emit("task.done", "operator"),
      emit("completion.accepted", "agent"),
      fields("completion.accepted", "1", {
        state: "accepted",
        human_ack: true,
      }),
      JSON.stringify({
        run: RUN,
        topic: "task.done",
        payload: 42,
        source: "agent",
      }),
      JSON.stringify({ run: RUN, topic: "task.done", source: "agent" }),
      emit("review.pass", "agent"),
    ]);
    expect(report.observations).toEqual([
      {
        ...base(1, "1"),
        kind: "accepted",
        event: "review.pass",
        source: "agent",
      },
    ]);
  });

  it("skips malformed envelopes and records from other runs", () => {
    const report = handoffsFromLines(RUN, [
      "not json",
      "[1,2]",
      "null",
      JSON.stringify({ run: RUN, fields: {} }),
      JSON.stringify({ run: RUN, topic: "", fields: {} }),
      JSON.stringify({ run: RUN, topic: 7, fields: {} }),
      JSON.stringify({ topic: "iteration.start", fields: {} }),
      JSON.stringify({ run: "run-b", topic: "iteration.start", fields: {} }),
      emit("task.done", "agent").replace(RUN, "run-b"),
      fields("backend.usage", "1", { total_tokens: 9 }),
    ]);
    expect(report.observations).toEqual([
      {
        ...base(1, "1"),
        kind: "usage",
        input_tokens: null,
        output_tokens: null,
        cache_read_tokens: null,
        cache_write_tokens: null,
        total_tokens: 9,
        cost_usd: null,
      },
    ]);
  });

  it("maps absent, non-object, or malformed fields to explicit nulls", () => {
    const report = handoffsFromLines(RUN, [
      JSON.stringify({ run: RUN, topic: "iteration.start", fields: "oops" }),
      JSON.stringify({
        run: RUN,
        iteration: 3,
        topic: "event.invalid",
        fields: [],
      }),
      fields("backend.transient", "", {
        pause_count: "two",
        backoff_ms: "1e999",
      }),
      fields("backend.usage", "1", {
        input_tokens: "NaN",
        output_tokens: "Infinity",
        cache_read_tokens: null,
        cache_write_tokens: true,
        total_tokens: " 12 ",
        cost_usd: "0x10",
      }),
      fields("iteration.finish", "1", {
        exit_code: "",
        timed_out: "yes",
        elapsed_s: "1.5s",
      }),
      fields("loop.complete", "4", { reason: `${CANARY} free text` }),
      fields("loop.stop", "4", { reason: 3 }),
      fields("iteration.start", "5", {
        recent_event: "",
        suggested_roles: ["a"],
        allowed_events: "",
        backpressure: `${CANARY} rejection text`,
      }),
    ]);
    expect(
      report.observations.map(
        ({ ordinal, actor_role, decision_maker, ...rest }) => rest,
      ),
    ).toEqual([
      {
        iteration: null,
        timestamp: null,
        kind: "decision",
        recent_event: null,
        suggested_roles: null,
        allowed_events: null,
        backpressure_present: null,
      },
      {
        iteration: null,
        timestamp: null,
        kind: "validation",
        validation: "rejected",
        emitted: null,
        recent_event: null,
        suggested_roles: null,
        allowed_events: null,
      },
      {
        iteration: null,
        timestamp: TS,
        kind: "retry",
        pause_count: null,
        backoff_ms: null,
      },
      {
        iteration: "1",
        timestamp: TS,
        kind: "usage",
        input_tokens: null,
        output_tokens: null,
        cache_read_tokens: null,
        cache_write_tokens: null,
        total_tokens: 12,
        cost_usd: null,
      },
      {
        iteration: "1",
        timestamp: TS,
        kind: "finish",
        scope: "iteration",
        exit_code: null,
        timed_out: null,
        elapsed_s: null,
      },
      {
        iteration: "4",
        timestamp: TS,
        kind: "terminal",
        event: "loop.complete",
        reason: null,
      },
      {
        iteration: "4",
        timestamp: TS,
        kind: "terminal",
        event: "loop.stop",
        reason: null,
      },
      {
        iteration: "5",
        timestamp: TS,
        kind: "decision",
        recent_event: null,
        suggested_roles: null,
        allowed_events: [],
        backpressure_present: true,
      },
    ]);
    expect(JSON.stringify(report)).not.toContain(CANARY);
  });

  it("rejects raw numbers that overflow to infinity and reads string false", () => {
    const report = handoffsFromLines(RUN, [
      `{"run":"${RUN}","topic":"backend.transient","fields":{"pause_count":1e999,"backoff_ms":-0.5}}`,
      fields("backend.finish", "1", { exit_code: -1, timed_out: "false" }),
    ]);
    expect(
      report.observations.map(
        ({ ordinal, actor_role, decision_maker, ...rest }) => rest,
      ),
    ).toEqual([
      {
        iteration: null,
        timestamp: null,
        kind: "retry",
        pause_count: null,
        backoff_ms: -0.5,
      },
      {
        iteration: "1",
        timestamp: TS,
        kind: "finish",
        scope: "backend",
        exit_code: -1,
        timed_out: false,
        elapsed_s: null,
      },
    ]);
  });

  it("reads legacy timestamp keys and rejects unparseable ones", () => {
    const legacy = (timestamp: unknown) =>
      JSON.stringify({
        run: RUN,
        iteration: "1",
        topic: "loop.stop",
        timestamp,
        fields: { reason: "abandoned" },
      });
    const report = handoffsFromLines(RUN, [
      legacy(TS),
      legacy("yesterday"),
      legacy(12),
    ]);
    expect(
      report.observations.map((row) => [
        row.timestamp,
        row.kind === "terminal" ? row.reason : null,
      ]),
    ).toEqual([
      [TS, "abandoned"],
      [null, "abandoned"],
      [null, "abandoned"],
    ]);
  });

  it("returns an empty report for a run with no routing records", () => {
    expect(
      handoffsFromLines(RUN, [fields("loop.start", undefined, {})]),
    ).toEqual({
      schema_version: 1,
      run_id: RUN,
      ordering: "journal_input",
      completeness: "not_established",
      observations: [],
    });
  });

  it("gives identical reports for repeated reads of the same lines", () => {
    const lines = [start("1", "loop.start", "a"), emit("a.done", "agent")];
    expect(JSON.stringify(handoffsFromLines(RUN, lines))).toBe(
      JSON.stringify(handoffsFromLines(RUN, [...lines])),
    );
  });
});

describe("formatHandoffs", () => {
  it("renders one row per observation with unknown values visible", () => {
    const report = handoffsFromLines(RUN, [
      start("1", "loop.start", "planner,builder"),
      emit("task.done", "agent"),
      fields("event.invalid", "1", { emitted: "task.bogus" }),
      fields("backend.transient", "1", { pause_count: "1" }),
      fields("backend.usage", "1", { total_tokens: 3 }),
      fields("iteration.finish", "1", { exit_code: "0", timed_out: false }),
      JSON.stringify({
        run: RUN,
        topic: "loop.complete",
        fields: { reason: "completed" },
      }),
    ]);
    expect(formatHandoffs(report)).toBe(
      [
        "## Handoffs: run-a",
        "Order: journal input. Completeness: not established. Actor and decision maker: unknown.",
        "",
        `#1 iter 1 ${TS} decision recent_event=loop.start suggested_roles=[planner,builder] allowed_events=[task.done,task.blocked] backpressure_present=false`,
        `#2 iter 1 ${TS} accepted event=task.done source=agent`,
        `#3 iter 1 ${TS} validation emitted=task.bogus recent_event=unknown suggested_roles=unknown allowed_events=unknown`,
        `#4 iter 1 ${TS} retry pause_count=1 backoff_ms=unknown`,
        `#5 iter 1 ${TS} usage input_tokens=unknown output_tokens=unknown cache_read_tokens=unknown cache_write_tokens=unknown total_tokens=3 cost_usd=unknown`,
        `#6 iter 1 ${TS} finish scope=iteration exit_code=0 timed_out=false elapsed_s=unknown`,
        "#7 iter ? ? terminal event=loop.complete reason=completed",
      ].join("\n"),
    );
  });

  it("says so when the run has no observations", () => {
    expect(formatHandoffs(handoffsFromLines(RUN, []))).toBe(
      [
        "## Handoffs: run-a",
        "Order: journal input. Completeness: not established. Actor and decision maker: unknown.",
        "",
        "No handoff observations recorded for this run.",
      ].join("\n"),
    );
  });
});
