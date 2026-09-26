import type { LoopEvent } from "@mobrienv/autoloop-harness/events";
import { describe, expect, it, vi } from "vitest";
import {
  type HerdrState,
  herdrActions,
  herdrEventSink,
  spawnHerdr,
} from "../../src/cli/herdr-sink.js";

const banner = (over: Partial<LoopEvent> = {}): LoopEvent =>
  ({
    type: "iteration.banner",
    iteration: 2,
    maxIterations: 5,
    allowedRoles: ["builder"],
    recentEvent: "tasks.ready",
    allowedEvents: [],
    backend: { kind: "pi", model: "opus" },
    ...over,
  }) as LoopEvent;

const progress = (emittedTopic?: string): LoopEvent => ({
  type: "progress",
  runId: "run-1",
  iteration: 3,
  recentEvent: "x",
  allowedRoles: [],
  emittedTopic,
  outcome: "ok",
});

const finish = (costUsd: number): LoopEvent => ({
  type: "loop.finish",
  iterations: 4,
  stopReason: "completed",
  runId: "run-1",
  costUsd,
});

describe("herdrActions", () => {
  it("reports a failed finish as blocked with an attention sound", () => {
    const state: HerdrState = { runId: "" };
    const actions = herdrActions(
      { ...finish(0), stopReason: "backend_failed" },
      state,
    );
    expect(actions[0]).toEqual({
      kind: "status",
      state: "blocked",
      message: "failed: backend_failed",
    });
    expect(actions[1]).toEqual({
      kind: "title",
      title: "autoloop run-1 · failed: backend_failed",
    });
    expect(actions[2]).toMatchObject({ kind: "notify", sound: "request" });
  });

  it("records runId and reports working + title on iteration.banner", () => {
    const state: HerdrState = { runId: "" };
    expect(
      herdrActions(
        {
          type: "iteration.start",
          iteration: 2,
          maxIterations: 5,
          runId: "run-1",
        },
        state,
      ),
    ).toEqual([]);
    expect(state.runId).toBe("run-1");
    expect(herdrActions(banner(), state)).toEqual([
      { kind: "status", state: "working", message: "iter 2 · builder · opus" },
      { kind: "title", title: "autoloop run-1 · builder" },
    ]);
  });

  it("falls back to backend kind, 'any' role, and a generic run label", () => {
    const state: HerdrState = { runId: "" };
    expect(
      herdrActions(
        banner({ allowedRoles: [], backend: { kind: "command", model: "" } }),
        state,
      ),
    ).toEqual([
      { kind: "status", state: "working", message: "iter 2 · any · command" },
      { kind: "title", title: "autoloop autoloop · any" },
    ]);
  });

  it("blocks and requests attention on ask.pending", () => {
    const state: HerdrState = { runId: "" };
    expect(
      herdrActions(
        {
          type: "ask.pending",
          runId: "run-1",
          iteration: 1,
          questionId: "q1",
          question: "ship it?",
        },
        state,
      ),
    ).toEqual([
      { kind: "status", state: "blocked", message: "asking: ship it?" },
      {
        kind: "notify",
        title: "run-1: needs an answer",
        body: "ship it?",
        sound: "request",
      },
    ]);
  });

  it("blocks on wait.open using the name or the reason", () => {
    const state: HerdrState = { runId: "" };
    const base = {
      type: "wait.open" as const,
      runId: "run-1",
      iteration: 1,
      waitId: "w1",
      reason: "ci",
    };
    expect(herdrActions({ ...base, name: "deploy" }, state)).toEqual([
      { kind: "status", state: "blocked", message: "waiting: deploy" },
    ]);
    expect(herdrActions(base, state)).toEqual([
      { kind: "status", state: "blocked", message: "waiting: ci" },
    ]);
  });

  it("returns to working when an ask or wait closes", () => {
    const state: HerdrState = { runId: "" };
    const working = [
      { kind: "status", state: "working", message: "iter 4 · resumed" },
    ];
    expect(
      herdrActions(
        {
          type: "ask.answered",
          runId: "r",
          iteration: 4,
          questionId: "q",
          answer: "y",
        },
        state,
      ),
    ).toEqual(working);
    expect(
      herdrActions(
        { type: "wait.close", runId: "r", iteration: 4, waitId: "w" },
        state,
      ),
    ).toEqual(working);
  });

  it("notifies only on attention progress topics", () => {
    const state: HerdrState = { runId: "" };
    for (const topic of [
      "review.rejected",
      "build.blocked",
      "finalization.failed",
    ]) {
      expect(herdrActions(progress(topic), state)).toEqual([
        {
          kind: "notify",
          title: `run-1: ${topic}`,
          body: "iteration 3",
          sound: "request",
        },
      ]);
    }
    expect(herdrActions(progress("tasks.ready"), state)).toEqual([]);
    expect(herdrActions(progress(), state)).toEqual([]);
  });

  it("goes idle and notifies done with cost on loop.finish, without releasing", () => {
    const state: HerdrState = { runId: "" };
    expect(herdrActions(finish(1.234), state)).toEqual([
      { kind: "status", state: "idle", message: "completed" },
      { kind: "title", title: "autoloop run-1 · completed" },
      {
        kind: "notify",
        title: "run-1: completed",
        body: "4 iterations · $1.23",
        sound: "done",
      },
    ]);
    expect(herdrActions(finish(0), state)[2]).toMatchObject({
      body: "4 iterations",
    });
  });

  it("ignores summary and other events", () => {
    const state: HerdrState = { runId: "" };
    expect(
      herdrActions({ type: "log", level: "info", message: "hi" }, state),
    ).toEqual([]);
    expect(
      herdrActions(
        {
          type: "summary",
          runId: "run-1",
          iterations: 1,
          stopReason: "completed",
          costUsd: 0,
          journalFile: "",
          memoryFile: "",
          reviewEvery: 0,
          toolPath: "",
        },
        state,
      ),
    ).toEqual([]);
  });
});

describe("herdrEventSink", () => {
  it("is undefined outside herdr and when disabled", () => {
    expect(herdrEventSink({})).toBeUndefined();
    expect(
      herdrEventSink({ HERDR_PANE_ID: "w1:p1", AUTOLOOP_HERDR: "0" }),
    ).toBeUndefined();
  });

  it("spawns herdr argv for status, title, notify, and release with rising seq", () => {
    const exec = vi.fn();
    const sink = herdrEventSink(
      { HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: "/bin/herdr" },
      exec,
    );
    sink?.onEvent({
      type: "iteration.start",
      iteration: 2,
      maxIterations: 5,
      runId: "run-1",
    });
    sink?.onEvent(banner());
    sink?.onEvent(finish(0));
    const owner = ["--source", "autoloop", "--agent", "autoloop"];
    const calls = exec.mock.calls as [string, string[]][];
    expect(calls.every(([bin]) => bin === "/bin/herdr")).toBe(true);
    const argvs = calls.map(([, argv]) => argv);
    const seqOf = (argv: string[]) => Number(argv[argv.indexOf("--seq") + 1]);
    expect(argvs[0].slice(0, 9)).toEqual([
      "pane",
      "report-agent",
      "w1:p1",
      ...owner,
      "--state",
      "working",
    ]);
    expect(argvs[0]).toContain("iter 2 · builder · opus");
    expect(argvs[1]).toEqual([
      "pane",
      "report-metadata",
      "w1:p1",
      ...owner,
      "--title",
      "autoloop run-1 · builder",
    ]);
    expect(argvs[2]).toContain("idle");
    expect(argvs[3]).toContain("autoloop run-1 · completed");
    expect(argvs[4]).toEqual([
      "notification",
      "show",
      "run-1: completed",
      "--body",
      "4 iterations",
      "--sound",
      "done",
    ]);
    expect(seqOf(argvs[2])).toBeGreaterThan(seqOf(argvs[0]));
    // A finished run keeps its idle report so herdr shows it as done.
    sink?.close();
    expect(exec).toHaveBeenCalledTimes(5);
    // A signal after finishing still drops the claim.
    sink?.release();
    expect((exec.mock.calls.at(-1) as [string, string[]])[1][1]).toBe(
      "release-agent",
    );
  });

  it("closes an unfinished run by releasing the pane", () => {
    const exec = vi.fn();
    const sink = herdrEventSink({ HERDR_PANE_ID: "w1:p1" }, exec);
    sink?.onEvent(banner());
    sink?.close();
    const last = (exec.mock.calls.at(-1) as [string, string[]])[1];
    expect(last.slice(0, 3)).toEqual(["pane", "release-agent", "w1:p1"]);
  });

  it("releases a run that stops without finishing", () => {
    const exec = vi.fn();
    const sink = herdrEventSink({ HERDR_PANE_ID: "w1:p1" }, exec);
    sink?.onEvent(banner());
    sink?.release();
    const last = (exec.mock.calls.at(-1) as [string, string[]])[1];
    expect(last.slice(0, 3)).toEqual(["pane", "release-agent", "w1:p1"]);
    sink?.release();
    expect(
      exec.mock.calls.filter(([, a]) => a[1] === "release-agent"),
    ).toHaveLength(1);
  });

  it("releases on demand only after claiming the pane", () => {
    const exec = vi.fn();
    const sink = herdrEventSink({ HERDR_PANE_ID: "w1:p1" }, exec);
    sink?.release();
    expect(exec).not.toHaveBeenCalled();
    sink?.onEvent(banner());
    sink?.release();
    expect(exec).toHaveBeenCalledTimes(3);
    expect(exec.mock.calls[2][0]).toBe("herdr");
    expect(exec.mock.calls[2][1][1]).toBe("release-agent");
  });

  it("swallows a throwing exec", () => {
    const sink = herdrEventSink({ HERDR_PANE_ID: "w1:p1" }, () => {
      throw new Error("boom");
    });
    expect(() => sink?.onEvent(banner())).not.toThrow();
  });
});

describe("spawnHerdr", () => {
  it("does not throw when the binary is missing", async () => {
    expect(() =>
      spawnHerdr("/nonexistent/herdr-binary", ["pane", "list"]),
    ).not.toThrow();
    // Let the async spawn error fire against the swallowing listener.
    await new Promise((r) => setTimeout(r, 50));
  });

  it("does not throw on invalid spawn arguments", () => {
    expect(() => spawnHerdr("", [])).not.toThrow();
  });
});
