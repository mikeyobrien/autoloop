import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveControlAdapter } from "../../src/control/adapter.js";
import { defaultCapabilities } from "../../src/control/capabilities.js";
import {
  drainControlRequests,
  publishCapabilities,
} from "../../src/control/dispatch.js";
import {
  appendRequest,
  buildRequest,
  pendingRequests,
  readCapabilities,
  readStatuses,
} from "../../src/control/queue.js";
import type { ControlAck, ControlRequest } from "../../src/control/types.js";

let runStateDir: string;

function makeAdapter(
  onRequest: (req: ControlRequest) => ControlAck = () => ({
    state: "applied",
  }),
): LiveControlAdapter {
  return {
    backend: "mock",
    capabilities: () => {
      const caps = defaultCapabilities("mock", "run-1");
      caps.interrupt = { supported: true };
      return caps;
    },
    onRequest,
  };
}

beforeEach(() => {
  runStateDir = mkdtempSync(join(tmpdir(), "ctrl-dispatch-"));
});

afterEach(() => {
  rmSync(runStateDir, { recursive: true, force: true });
});

describe("publishCapabilities", () => {
  it("writes the adapter's capabilities to capabilities.json", () => {
    const adapter = makeAdapter();
    publishCapabilities(runStateDir, adapter);
    const read = readCapabilities(runStateDir);
    expect(read?.backend).toBe("mock");
    expect(read?.interrupt.supported).toBe(true);
  });
});

describe("drainControlRequests", () => {
  it("acks every pending request and clears the pending queue", () => {
    const adapter = makeAdapter();
    appendRequest(runStateDir, buildRequest("run-1", "interrupt", {}));
    appendRequest(
      runStateDir,
      buildRequest("run-1", "guide", { message: "go", interrupt: false }),
    );
    const drained = drainControlRequests(runStateDir, adapter);
    expect(drained).toHaveLength(2);
    expect(pendingRequests(runStateDir)).toHaveLength(0);
    const statuses = readStatuses(runStateDir);
    expect(statuses).toHaveLength(2);
    expect(statuses.every((s) => s.state === "applied")).toBe(true);
  });

  it("records rejected status when the adapter throws", () => {
    const adapter = makeAdapter(() => {
      throw new Error("adapter-explode");
    });
    appendRequest(runStateDir, buildRequest("run-1", "interrupt", {}));
    drainControlRequests(runStateDir, adapter);
    const statuses = readStatuses(runStateDir);
    expect(statuses).toHaveLength(1);
    expect(statuses[0].state).toBe("rejected");
    expect(statuses[0].detail).toContain("adapter-explode");
  });

  it("does not double-ack requests on a second drain", () => {
    const onRequest = vi.fn().mockReturnValue({ state: "applied" });
    const adapter = makeAdapter(onRequest);
    appendRequest(runStateDir, buildRequest("run-1", "interrupt", {}));
    drainControlRequests(runStateDir, adapter);
    drainControlRequests(runStateDir, adapter);
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(readStatuses(runStateDir)).toHaveLength(1);
  });
});
