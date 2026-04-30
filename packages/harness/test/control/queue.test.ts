import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultCapabilities } from "../../src/control/capabilities.js";
import {
  controlCapabilitiesFile,
  controlRequestsFile,
  controlStatusFile,
} from "../../src/control/paths.js";
import {
  appendRequest,
  appendStatus,
  buildRequest,
  pendingRequests,
  readCapabilities,
  readRequests,
  readStatuses,
  writeCapabilities,
} from "../../src/control/queue.js";
import type { ControlStatus } from "../../src/control/types.js";

let runStateDir: string;

beforeEach(() => {
  runStateDir = mkdtempSync(join(tmpdir(), "ctrl-queue-"));
});

afterEach(() => {
  rmSync(runStateDir, { recursive: true, force: true });
});

describe("control queue round-trip", () => {
  it("writes and reads interrupt requests", () => {
    const req = buildRequest("run-1", "interrupt", {}, "manual");
    appendRequest(runStateDir, req);

    const all = readRequests(runStateDir);
    expect(all).toHaveLength(1);
    expect(all[0].runId).toBe("run-1");
    expect(all[0].verb).toBe("interrupt");
    expect(all[0].reason).toBe("manual");
    expect(existsSync(controlRequestsFile(runStateDir))).toBe(true);
  });

  it("writes and reads guide requests with payload", () => {
    const req = buildRequest(
      "run-2",
      "guide",
      { message: "pivot", interrupt: true },
      "pivot",
    );
    appendRequest(runStateDir, req);
    const all = readRequests(runStateDir);
    expect(all[0].payload).toMatchObject({ message: "pivot", interrupt: true });
  });

  it("pendingRequests filters out requests that already have a status", () => {
    const r1 = buildRequest("run-1", "interrupt", {}, "first");
    const r2 = buildRequest("run-1", "interrupt", {}, "second");
    appendRequest(runStateDir, r1);
    appendRequest(runStateDir, r2);

    const status1: ControlStatus = {
      id: r1.id,
      runId: "run-1",
      verb: "interrupt",
      state: "applied",
      at: new Date().toISOString(),
    };
    appendStatus(runStateDir, status1);

    const pending = pendingRequests(runStateDir);
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(r2.id);
    expect(readStatuses(runStateDir)).toHaveLength(1);
  });

  it("skips malformed lines without throwing", () => {
    appendRequest(runStateDir, buildRequest("run-1", "interrupt", {}));
    const path = controlRequestsFile(runStateDir);
    const current = readFileSync(path, "utf-8");
    appendFileSync(path, "not-json\n");
    expect(() => readRequests(runStateDir)).not.toThrow();
    expect(readRequests(runStateDir)).toHaveLength(1);
    expect(current.length).toBeGreaterThan(0);
  });
});

describe("capabilities round-trip", () => {
  it("writes and reads capabilities", () => {
    const caps = defaultCapabilities("kiro", "run-1");
    caps.interrupt = { supported: true, detail: "ACP cancel" };
    writeCapabilities(runStateDir, caps);

    expect(existsSync(controlCapabilitiesFile(runStateDir))).toBe(true);
    const read = readCapabilities(runStateDir);
    expect(read?.backend).toBe("kiro");
    expect(read?.interrupt.supported).toBe(true);
    expect(read?.interrupt.detail).toBe("ACP cancel");
    expect(read?.guidance.supported).toBe(true);
  });

  it("returns null when capabilities file missing", () => {
    expect(readCapabilities(runStateDir)).toBeNull();
  });
});

describe("paths", () => {
  it("resolves the expected control subpaths", () => {
    expect(controlRequestsFile(runStateDir)).toBe(
      join(runStateDir, "control", "requests.jsonl"),
    );
    expect(controlStatusFile(runStateDir)).toBe(
      join(runStateDir, "control", "status.jsonl"),
    );
    expect(controlCapabilitiesFile(runStateDir)).toBe(
      join(runStateDir, "control", "capabilities.json"),
    );
  });
});
