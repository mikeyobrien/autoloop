import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  drainControlRequests,
  publishCapabilities,
} from "../../src/control/dispatch.js";
import { kiroControlAdapter } from "../../src/control/kiro-adapter.js";
import {
  appendRequest,
  buildRequest,
  pendingRequests,
  readCapabilities,
  readStatuses,
} from "../../src/control/queue.js";

let runStateDir: string;

beforeEach(() => {
  runStateDir = mkdtempSync(join(tmpdir(), "kiro-live-"));
});

afterEach(() => {
  rmSync(runStateDir, { recursive: true, force: true });
});

describe("kiro live-interrupt flow (file → drain → hook)", () => {
  it("interrupt request triggers signalInterrupt hook and records applied", () => {
    const signalInterrupt = vi.fn();
    const adapter = kiroControlAdapter("run-k", {
      triggerInterrupt: signalInterrupt,
    });
    publishCapabilities(runStateDir, adapter);

    // CLI path: a separate process writes a request to the queue
    appendRequest(
      runStateDir,
      buildRequest("run-k", "interrupt", {}, "operator stop"),
    );

    // Harness SIGUSR1 handler: drain
    const drained = drainControlRequests(runStateDir, adapter);

    expect(drained).toHaveLength(1);
    expect(signalInterrupt).toHaveBeenCalledTimes(1);
    expect(pendingRequests(runStateDir)).toHaveLength(0);
    const statuses = readStatuses(runStateDir);
    expect(statuses).toHaveLength(1);
    expect(statuses[0].state).toBe("applied");
    expect(statuses[0].verb).toBe("interrupt");
    expect(statuses[0].detail).toContain("signalled kiro");

    const caps = readCapabilities(runStateDir);
    expect(caps?.interrupt.supported).toBe(true);
  });

  it("guide + interrupt=true also triggers the interrupt hook in one request", () => {
    const signalInterrupt = vi.fn();
    const adapter = kiroControlAdapter("run-k", {
      triggerInterrupt: signalInterrupt,
    });

    appendRequest(
      runStateDir,
      buildRequest(
        "run-k",
        "guide",
        { message: "pivot to plan B", interrupt: true },
        "guide",
      ),
    );

    drainControlRequests(runStateDir, adapter);

    expect(signalInterrupt).toHaveBeenCalledTimes(1);
    const statuses = readStatuses(runStateDir);
    expect(statuses).toHaveLength(1);
    expect(statuses[0].verb).toBe("guide");
    expect(statuses[0].state).toBe("applied");
    expect(statuses[0].detail).toContain("guidance-driven");
  });

  it("guide with interrupt=false does not fire the interrupt hook", () => {
    const signalInterrupt = vi.fn();
    const adapter = kiroControlAdapter("run-k", {
      triggerInterrupt: signalInterrupt,
    });

    appendRequest(
      runStateDir,
      buildRequest("run-k", "guide", {
        message: "when you get a moment",
        interrupt: false,
      }),
    );

    drainControlRequests(runStateDir, adapter);
    expect(signalInterrupt).not.toHaveBeenCalled();
    expect(readStatuses(runStateDir)[0].state).toBe("applied");
  });

  it("a thrown signalInterrupt surfaces as rejected, not uncaught", () => {
    const adapter = kiroControlAdapter("run-k", {
      triggerInterrupt: () => {
        throw new Error("child already dead");
      },
    });
    appendRequest(runStateDir, buildRequest("run-k", "interrupt", {}));
    drainControlRequests(runStateDir, adapter);
    const s = readStatuses(runStateDir)[0];
    expect(s.state).toBe("rejected");
    expect(s.detail).toContain("child already dead");
  });
});
