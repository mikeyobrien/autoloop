import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeEvent } from "@mobrienv/autoloop-core";
import { appendAgentEvent, appendEvent } from "@mobrienv/autoloop-core/journal";
import { emit } from "@mobrienv/autoloop-harness/emit";
import { finishIteration } from "@mobrienv/autoloop-harness/iteration";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import {
  isWaitLifecycleTopic,
  isWaitRequestTopic,
  openWaitFromLines,
  parseWaitRequest,
  sanitizeWaitName,
  WAIT_CLOSE_TOPIC,
  WAIT_OPEN_TOPIC,
  WAIT_REQUEST_TOPIC,
  waitCloseFields,
  waitIdFor,
  waitOpenFields,
} from "@mobrienv/autoloop-harness/wait";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("wait.request topics", () => {
  it("recognizes the reserved request and lifecycle names", () => {
    expect(isWaitRequestTopic(WAIT_REQUEST_TOPIC)).toBe(true);
    expect(isWaitRequestTopic("human.ask")).toBe(false);
    expect(isWaitLifecycleTopic(WAIT_OPEN_TOPIC)).toBe(true);
    expect(isWaitLifecycleTopic(WAIT_CLOSE_TOPIC)).toBe(true);
    expect(isWaitLifecycleTopic(WAIT_REQUEST_TOPIC)).toBe(false);
  });
});

describe("parseWaitRequest", () => {
  it("treats free text as the reason", () => {
    const parsed = parseWaitRequest("nap until morning");
    expect(parsed.reason).toBe("nap until morning");
    expect(parsed.name).toBe("");
    expect(parsed.duration).toBe("");
    expect(parsed.durationMs).toBe(0);
  });

  it("trims a blank payload to an empty reason", () => {
    const parsed = parseWaitRequest("   ");
    expect(parsed.reason).toBe("");
    expect(parsed.name).toBe("");
  });

  it("reads structured name, duration, and reason pairs", () => {
    const parsed = parseWaitRequest(
      "name=company-nap; duration=300s; reason=between company steps;",
    );
    expect(parsed.name).toBe("company-nap");
    expect(parsed.duration).toBe("300s");
    expect(parsed.durationMs).toBe(300_000);
    expect(parsed.reason).toBe("between company steps");
  });

  it("keeps leftover prose as the reason when reason= is absent", () => {
    const parsed = parseWaitRequest("duration=5m; hold for review");
    expect(parsed.duration).toBe("5m");
    expect(parsed.durationMs).toBe(300_000);
    expect(parsed.reason).toBe("hold for review");
  });

  it("ignores unknown keys and invalid durations", () => {
    const parsed = parseWaitRequest("foo=bar; duration=nope; reason=park;");
    expect(parsed.reason).toBe("park");
    expect(parsed.duration).toBe("nope");
    expect(parsed.durationMs).toBe(0);
  });

  it("accepts a bare-millisecond duration", () => {
    const parsed = parseWaitRequest("duration=1500; reason=short;");
    expect(parsed.durationMs).toBe(1500);
  });
});

describe("waitIdFor / sanitizeWaitName", () => {
  it("uses a sanitized supplied name", () => {
    expect(waitIdFor("swift-agent", 3, "Company Nap")).toBe("company-nap");
    expect(sanitizeWaitName("Company Nap")).toBe("company-nap");
  });

  it("falls back to wait_<runId>_<iteration> when the name is empty or illegal", () => {
    expect(waitIdFor("swift-agent", 3, "")).toBe("wait_swift-agent_3");
    expect(waitIdFor("swift-agent", 3, "!!!")).toBe("wait_swift-agent_3");
    expect(sanitizeWaitName("")).toBe("");
    expect(sanitizeWaitName("---")).toBe("");
  });
});

describe("wait open/close field encoding", () => {
  it("includes optional name and duration when present", () => {
    const fields = waitOpenFields("company-nap", {
      name: "company-nap",
      reason: "between steps",
      duration: "300s",
      durationMs: 300_000,
    });
    expect(fields).toContain('"wait_id": "company-nap"');
    expect(fields).toContain('"reason": "between steps"');
    expect(fields).toContain('"name": "company-nap"');
    expect(fields).toContain('"duration": "300s"');
    expect(fields).toContain('"duration_ms": "300000"');
  });

  it("omits empty optional fields", () => {
    const fields = waitOpenFields("wait_run_1", {
      name: "",
      reason: "nap",
      duration: "",
      durationMs: 0,
    });
    expect(fields).toContain('"wait_id": "wait_run_1"');
    expect(fields).toContain('"reason": "nap"');
    expect(fields).not.toContain('"name"');
    expect(fields).not.toContain("duration");
  });

  it("encodes wait.close with the wait id", () => {
    expect(waitCloseFields("company-nap")).toContain(
      '"wait_id": "company-nap"',
    );
  });
});

describe("openWaitFromLines", () => {
  const run = "swift-agent";

  function openLine(waitId: string, iteration = "1"): string {
    return encodeEvent({
      shape: "fields",
      run,
      iteration,
      topic: WAIT_OPEN_TOPIC,
      fields: { wait_id: waitId, reason: "nap" },
    }).trim();
  }

  function closeLine(waitId: string): string {
    return encodeEvent({
      shape: "fields",
      run,
      topic: WAIT_CLOSE_TOPIC,
      fields: { wait_id: waitId },
    }).trim();
  }

  it("returns the latest unmatched wait.open", () => {
    const open = openWaitFromLines([openLine("wait_a")], run);
    expect(open).toEqual({
      waitId: "wait_a",
      reason: "nap",
      name: "",
      duration: "",
      iteration: "1",
    });
  });

  it("returns null when the latest open has been closed", () => {
    expect(
      openWaitFromLines([openLine("wait_a"), closeLine("wait_a")], run),
    ).toBeNull();
  });

  it("ignores other runs and malformed lines", () => {
    const other = encodeEvent({
      shape: "fields",
      run: "other",
      topic: WAIT_OPEN_TOPIC,
      fields: { wait_id: "other-wait" },
    }).trim();
    expect(openWaitFromLines(["not-json", other], run)).toBeNull();
  });

  it("reopens after a close when a later wait.open appears", () => {
    const open = openWaitFromLines(
      [openLine("wait_a"), closeLine("wait_a"), openLine("wait_b", "4")],
      run,
    );
    expect(open?.waitId).toBe("wait_b");
    expect(open?.iteration).toBe("4");
  });
});

describe("emit accepts wait.request regardless of topology", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("journals wait.request even when allowed events are restricted", () => {
    const dir = mkdtempSync(join(tmpdir(), "autoloop-wait-emit-"));
    mkdirSync(join(dir, ".autoloop"), { recursive: true });
    writeFileSync(join(dir, "autoloops.toml"), "");
    const journalFile = join(dir, ".autoloop", "journal.jsonl");
    appendEvent(journalFile, "run-1", "1", "loop.start", "");
    vi.stubEnv("AUTOLOOP_JOURNAL_FILE", journalFile);
    vi.stubEnv("AUTOLOOP_RUN_ID", "run-1");
    vi.stubEnv("AUTOLOOP_ITERATION", "1");
    vi.stubEnv("AUTOLOOP_ALLOWED_EVENTS", "review.ready,task.complete");
    vi.stubEnv("AUTOLOOP_RECENT_EVENT", "loop.start");

    const result = emit(dir, "wait.request", "name=nap; reason=hold;");
    expect(result.ok).toBe(true);
    expect(result.topic).toBe("wait.request");
    const journal = readFileSync(journalFile, "utf-8");
    expect(journal).toContain('"topic": "wait.request"');
    expect(journal).not.toContain('"topic": "event.invalid"');
  });
});

describe("finishIteration parks on wait.request", () => {
  it("journals wait.open and returns waiting without calling iterate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autoloop-wait-finish-"));
    const stateDir = join(dir, ".autoloop");
    mkdirSync(stateDir, { recursive: true });
    const journalFile = join(stateDir, "journal.jsonl");
    const registryFile = join(stateDir, "registry.jsonl");
    appendEvent(journalFile, "swift-agent", "1", "loop.start", "");
    appendAgentEvent(
      journalFile,
      "swift-agent",
      "1",
      "wait.request",
      "name=company-nap; duration=300s; reason=between steps;",
    );

    const events: Array<{ type: string }> = [];
    const loop = {
      ask: { enabled: true, event: "human.ask", timeoutMs: 0, pollMs: 0 },
      parallel: { enabled: false },
      completion: {
        promise: "LOOP_COMPLETE",
        event: "task.complete",
        requiredEvents: [],
        mustBeLast: false,
      },
      topology: {
        roles: [],
        handoff: {},
        handoffKeys: [],
        gates: [],
        stages: [],
      },
      paths: {
        journalFile,
        registryFile,
        tasksFile: join(stateDir, "tasks.jsonl"),
        stateDir,
      },
      runtime: { runId: "swift-agent" },
      launch: {
        preset: "test",
        trigger: "cli",
        createdAt: new Date().toISOString(),
        parentRunId: "",
      },
      objective: "park",
      backend: { kind: "command", command: "echo", args: [] },
      limits: { maxIterations: 5 },
      lastVerdict: undefined,
      onEvent: (e: { type: string }) => {
        events.push(e);
      },
    } as unknown as LoopContext;

    const iterate = vi.fn();
    const summary = await finishIteration(
      loop,
      {
        iteration: 1,
        recentEvent: "loop.start",
        allowedRoles: ["builder"],
        allowedEvents: ["review.ready"],
      },
      "parking",
      iterate,
    );

    expect(iterate).not.toHaveBeenCalled();
    expect(summary.stopReason).toBe("waiting");
    expect(summary.runId).toBeUndefined();
    expect(summary.iterations).toBe(1);
    const journal = readFileSync(journalFile, "utf-8");
    expect(journal).toContain('"topic": "wait.open"');
    expect(journal).toContain('"wait_id": "company-nap"');
    expect(journal).toContain('"topic": "loop.stop"');
    expect(journal).toContain('"reason": "waiting"');
    expect(events.some((e) => e.type === "wait.open")).toBe(true);
    const record = JSON.parse(
      readFileSync(registryFile, "utf-8").trim().split("\n").at(-1) ?? "{}",
    );
    expect(record.status).toBe("waiting");
    expect(record.pid).toBeUndefined();
  });
});
