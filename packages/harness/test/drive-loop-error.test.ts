import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendEvent,
  extractField,
  extractRun,
  extractTopic,
  readRunLines,
} from "@mobrienv/autoloop-core/journal";
import { getRun } from "@mobrienv/autoloop-core/registry/read";
import { driveLoop } from "@mobrienv/autoloop-harness";
import { registryStart } from "@mobrienv/autoloop-harness/registry-bridge";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stopStalled } from "../src/stop.js";

vi.mock("../src/config-helpers.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/config-helpers.js")>();
  return {
    ...actual,
    installRuntimeTools: vi.fn(),
    reloadLoop: vi.fn((loop: LoopContext) => loop),
  };
});

vi.mock("../src/metareview.js", () => ({
  maybeRunMetareview: vi.fn((loop: LoopContext) => loop),
}));

const runIteration = vi.hoisted(() => vi.fn());
vi.mock("../src/iteration.js", () => ({ runIteration }));

interface TerminalJournalRecord {
  v: number;
  run: string;
  topic: string;
  ts: string;
  iteration?: string;
  fields: Record<string, unknown>;
}

const temporaryDirectories: string[] = [];
let runCounter = 0;

function makeLoopContext(): LoopContext {
  const stateDir = mkdtempSync(join(tmpdir(), "autoloop-drive-error-"));
  temporaryDirectories.push(stateDir);
  const runId = `drive-error-${++runCounter}`;

  return {
    objective: "test unexpected iteration error",
    launch: {
      preset: "test",
      trigger: "cli",
      createdAt: "2026-01-01T00:00:00.000Z",
      parentRunId: "",
    },
    backend: {
      kind: "command",
      provider: "",
      command: "test-backend",
      args: [],
      promptMode: "arg",
      timeoutMs: 1_000,
      trustAllTools: true,
      agent: "",
      model: "",
      disallowedTools: [],
      usageFrom: "",
    },
    paths: {
      projectDir: stateDir,
      workDir: stateDir,
      stateDir,
      journalFile: join(stateDir, "journal.jsonl"),
      registryFile: join(stateDir, "registry.jsonl"),
      memoryFile: join(stateDir, "memory.md"),
      runMemoryFile: join(stateDir, "run-memory.md"),
      tasksFile: join(stateDir, "tasks.md"),
      toolPath: join(stateDir, "autoloops"),
      piAdapterPath: join(stateDir, "pi-adapter"),
      baseStateDir: stateDir,
      mainProjectDir: stateDir,
      worktreeBranch: "",
      worktreePath: "",
      worktreeMetaDir: "",
      configWorkDir: stateDir,
    },
    runtime: {
      runId,
      selfCommand: "autoloop",
      promptOverride: null,
      backendOverride: {},
      configOverride: {},
      logLevel: "none",
      branchMode: false,
      isolationMode: "shared",
    },
    limits: { maxIterations: 1 },
    completion: {
      promise: "LOOP_COMPLETE",
      event: "task.complete",
      requiredEvents: [],
      mustBeLast: false,
    },
    acpSession: { current: undefined },
    piSession: { current: undefined },
    claudeSdkSession: { current: undefined },
    commandSession: { current: undefined },
  } as unknown as LoopContext;
}

beforeEach(() => {
  runIteration.mockReset();
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("driveLoop unexpected errors", () => {
  it("journals the terminal error and stops the registry entry", async () => {
    const originalError = new Error("boom-ga4");
    runIteration.mockRejectedValueOnce(originalError);
    const loop = makeLoopContext();
    registryStart(loop);

    await expect(driveLoop(loop, {}, 1)).rejects.toBe(originalError);

    const journalLines = readRunLines(
      loop.paths.journalFile,
      loop.runtime.runId,
    );
    const terminalLine = journalLines.at(-1);
    expect(terminalLine).toBeDefined();
    expect(extractRun(terminalLine ?? "")).toBe(loop.runtime.runId);
    expect(extractTopic(terminalLine ?? "")).toBe("loop.stop");
    expect(extractField(terminalLine ?? "", "reason")).toBe("error");

    const registryRecord = getRun(loop.paths.registryFile, loop.runtime.runId);
    expect(registryRecord).toMatchObject({
      status: "stopped",
      stop_reason: "error",
    });
    expect(registryRecord?.updated_at.length).toBeGreaterThan(0);
  });

  it("preserves the original error and stops the registry when journaling fails", async () => {
    const originalError = new Error("boom-ga4");
    runIteration.mockRejectedValueOnce(originalError);
    const loop = makeLoopContext();
    loop.paths.journalFile = loop.paths.stateDir;
    expect(() =>
      appendEvent(loop.paths.journalFile, loop.runtime.runId, "", "probe", ""),
    ).toThrow();
    registryStart(loop);

    await expect(driveLoop(loop, {}, 1)).rejects.toBe(originalError);

    expect(getRun(loop.paths.registryFile, loop.runtime.runId)).toMatchObject({
      status: "stopped",
      stop_reason: "error",
    });
  });

  it("writes durable terminal records when an event callback rejects error logging", async () => {
    const originalError = new Error("boom-ga4");
    runIteration.mockRejectedValueOnce(originalError);
    const loop = makeLoopContext();
    loop.onEvent = (event) => {
      if (
        event.type === "log" &&
        event.message.startsWith("loop stop reason=error")
      ) {
        throw new Error("event-handler-failed");
      }
    };
    registryStart(loop);

    await expect(driveLoop(loop, {}, 1)).rejects.toBe(originalError);

    const terminalLine = readRunLines(
      loop.paths.journalFile,
      loop.runtime.runId,
    ).at(-1);
    expect(extractTopic(terminalLine ?? "")).toBe("loop.stop");
    expect(extractField(terminalLine ?? "", "reason")).toBe("error");
    expect(getRun(loop.paths.registryFile, loop.runtime.runId)).toMatchObject({
      status: "stopped",
      stop_reason: "error",
    });
  });

  it("uses the same terminal journal envelope as a normal stop", async () => {
    const originalError = "boom-ga4";
    runIteration.mockRejectedValueOnce(originalError);
    const errorLoop = makeLoopContext();
    registryStart(errorLoop);

    await expect(driveLoop(errorLoop, {}, 1)).rejects.toBe(originalError);

    const normalLoop = makeLoopContext();
    registryStart(normalLoop);
    stopStalled(normalLoop, 0, 2);

    const errorLine = readRunLines(
      errorLoop.paths.journalFile,
      errorLoop.runtime.runId,
    ).at(-1);
    const normalLine = readRunLines(
      normalLoop.paths.journalFile,
      normalLoop.runtime.runId,
    ).at(-1);
    expect(errorLine).toBeDefined();
    expect(normalLine).toBeDefined();

    const errorRecord = JSON.parse(errorLine ?? "{}") as TerminalJournalRecord;
    const normalRecord = JSON.parse(
      normalLine ?? "{}",
    ) as TerminalJournalRecord;
    const envelope = (record: TerminalJournalRecord) => ({
      fieldTypes: {
        completedIterations: typeof record.fields.completed_iterations,
        reason: typeof record.fields.reason,
      },
      hasIteration: Object.hasOwn(record, "iteration"),
      topLevelKeys: Object.keys(record).sort(),
      topic: record.topic,
      version: record.v,
    });

    expect(envelope(errorRecord)).toEqual(envelope(normalRecord));
    expect(errorRecord.fields.reason).toBe("error");
    expect(normalRecord.fields.reason).toBe("stalled");
    expect(errorRecord.fields.completed_iterations).toBe(
      normalRecord.fields.completed_iterations,
    );
  });

  it("preserves an unstringifiable thrown value while recording the stop", async () => {
    const hostile = Object.create(null);
    runIteration.mockRejectedValueOnce(hostile);
    const loop = makeLoopContext();
    registryStart(loop);

    await expect(driveLoop(loop, {}, 1)).rejects.toBe(hostile);

    const terminalLine = readRunLines(
      loop.paths.journalFile,
      loop.runtime.runId,
    ).at(-1);
    expect(extractTopic(terminalLine ?? "")).toBe("loop.stop");
    expect(extractField(terminalLine ?? "", "reason")).toBe("error");
    expect(extractField(terminalLine ?? "", "detail")).toBe(
      "unserializable error",
    );
    expect(getRun(loop.paths.registryFile, loop.runtime.runId)).toMatchObject({
      status: "stopped",
      stop_reason: "error",
    });
  });

  it("preserves an Error whose message getter throws while recording the stop", async () => {
    const hostile = new Error("placeholder");
    Object.defineProperty(hostile, "message", {
      get() {
        throw new Error("message-getter-bomb");
      },
    });
    runIteration.mockRejectedValueOnce(hostile);
    const loop = makeLoopContext();
    registryStart(loop);

    await expect(driveLoop(loop, {}, 1)).rejects.toBe(hostile);

    const terminalLine = readRunLines(
      loop.paths.journalFile,
      loop.runtime.runId,
    ).at(-1);
    expect(extractTopic(terminalLine ?? "")).toBe("loop.stop");
    expect(extractField(terminalLine ?? "", "reason")).toBe("error");
    expect(extractField(terminalLine ?? "", "detail")).toBe(
      "unserializable error",
    );
    expect(getRun(loop.paths.registryFile, loop.runtime.runId)).toMatchObject({
      status: "stopped",
      stop_reason: "error",
    });
  });
});
