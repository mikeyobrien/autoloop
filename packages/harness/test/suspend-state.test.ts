import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SUSPEND_STATE_SCHEMA_VERSION } from "@mobrienv/autoloop-core/hooks-schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearResumeRequest,
  clearSuspendState,
  readSuspendState,
  requestResume,
  resumeRequested,
  suspendStatePath,
  waitForResume,
  writeSuspendState,
} from "../src/suspend-state.js";

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "autoloop-suspend-state-"));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe("suspend-state: write/read/clear round-trip", () => {
  it("writes a versioned suspend-state.json and reads it back", () => {
    const written = writeSuspendState(stateDir, {
      runId: "run-1",
      phase: "pre_iteration",
      iteration: 4,
      reason: "needs human approval",
      hookCommand: "./approve.sh",
      createdAt: new Date().toISOString(),
      resumeIteration: 4,
    });

    expect(written.schemaVersion).toBe(SUSPEND_STATE_SCHEMA_VERSION);
    expect(existsSync(suspendStatePath(stateDir))).toBe(true);

    const read = readSuspendState(stateDir);
    expect(read).not.toBeNull();
    expect(read?.schemaVersion).toBe(1);
    expect(read?.runId).toBe("run-1");
    expect(read?.resumeIteration).toBe(4);
  });

  it("returns null when no suspend state exists", () => {
    expect(readSuspendState(stateDir)).toBeNull();
  });

  it("returns null for a corrupt suspend-state.json", () => {
    writeSuspendState(stateDir, {
      runId: "run-1",
      phase: "pre_run",
      iteration: 0,
      reason: "x",
      hookCommand: "y",
      createdAt: new Date().toISOString(),
      resumeIteration: 1,
    });
    // Corrupt it in place.
    const path = suspendStatePath(stateDir);
    const original = readFileSync(path, "utf-8");
    expect(original.length).toBeGreaterThan(0);
    writeFileSync(path, "{not json");
    expect(readSuspendState(stateDir)).toBeNull();
  });

  it("clearSuspendState removes the file and reports whether it existed", () => {
    expect(clearSuspendState(stateDir)).toBe(false);
    writeSuspendState(stateDir, {
      runId: "run-1",
      phase: "post_run",
      iteration: 2,
      reason: "x",
      hookCommand: "y",
      createdAt: new Date().toISOString(),
      resumeIteration: 3,
    });
    expect(clearSuspendState(stateDir)).toBe(true);
    expect(readSuspendState(stateDir)).toBeNull();
  });

  it("journals hook.suspend when a journalFile is passed", () => {
    const journalFile = join(stateDir, "journal.jsonl");
    writeSuspendState(
      stateDir,
      {
        runId: "run-1",
        phase: "pre_iteration",
        iteration: 1,
        reason: "needs approval",
        hookCommand: "./approve.sh",
        createdAt: new Date().toISOString(),
        resumeIteration: 1,
      },
      journalFile,
    );
    const journal = readFileSync(journalFile, "utf-8");
    expect(journal).toContain('"topic": "hook.suspend"');
    expect(journal).toContain("needs approval");
  });
});

describe("suspend-state: resume signal", () => {
  it("resumeRequested is false until requestResume is called", () => {
    expect(resumeRequested(stateDir)).toBe(false);
    requestResume(stateDir);
    expect(resumeRequested(stateDir)).toBe(true);
  });

  it("clearResumeRequest removes the signal and reports whether it existed", () => {
    expect(clearResumeRequest(stateDir)).toBe(false);
    requestResume(stateDir);
    expect(clearResumeRequest(stateDir)).toBe(true);
    expect(resumeRequested(stateDir)).toBe(false);
  });

  it("waitForResume resolves true once resume-requested appears", async () => {
    const promise = waitForResume(stateDir, { pollMs: 20 });
    setTimeout(() => requestResume(stateDir), 30);
    expect(await promise).toBe(true);
  });

  it("waitForResume resolves false when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const resumed = await waitForResume(stateDir, {
      pollMs: 10,
      signal: controller.signal,
    });
    expect(resumed).toBe(false);
  });

  it("waitForResume resolves false on timeout", async () => {
    const resumed = await waitForResume(stateDir, {
      pollMs: 10,
      timeoutMs: 30,
    });
    expect(resumed).toBe(false);
  });
});
