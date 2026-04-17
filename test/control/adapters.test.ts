import { describe, expect, it, vi } from "vitest";
import { kiroControlAdapter } from "../../src/control/kiro-adapter.js";
import { piControlAdapter } from "../../src/control/pi-adapter.js";
import { buildRequest } from "../../src/control/queue.js";

describe("kiroControlAdapter", () => {
  it("reports interrupt as supported", () => {
    const adapter = kiroControlAdapter("run-1", { triggerInterrupt: () => {} });
    const caps = adapter.capabilities();
    expect(caps.backend).toBe("kiro");
    expect(caps.interrupt.supported).toBe(true);
    expect(caps.interrupt.detail).toContain("cancel");
    expect(caps.guidance.supported).toBe(true);
    expect(caps.inspect.supported).toBe(true);
  });

  it("invokes triggerInterrupt on interrupt verb", () => {
    const interrupt = vi.fn();
    const adapter = kiroControlAdapter("run-1", {
      triggerInterrupt: interrupt,
    });
    const ack = adapter.onRequest(buildRequest("run-1", "interrupt", {}));
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(ack.state).toBe("applied");
  });

  it("invokes interrupt when guide payload requests it", () => {
    const interrupt = vi.fn();
    const adapter = kiroControlAdapter("run-1", {
      triggerInterrupt: interrupt,
    });
    const ack = adapter.onRequest(
      buildRequest("run-1", "guide", {
        message: "pivot",
        interrupt: true,
      }),
    );
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(ack.state).toBe("applied");
    expect(ack.detail).toContain("guidance-driven");
  });

  it("does not invoke interrupt when guide payload suppresses it", () => {
    const interrupt = vi.fn();
    const adapter = kiroControlAdapter("run-1", {
      triggerInterrupt: interrupt,
    });
    const ack = adapter.onRequest(
      buildRequest("run-1", "guide", {
        message: "later",
        interrupt: false,
      }),
    );
    expect(interrupt).not.toHaveBeenCalled();
    expect(ack.state).toBe("applied");
  });

  it("reports rejected when the hook throws", () => {
    const adapter = kiroControlAdapter("run-1", {
      triggerInterrupt: () => {
        throw new Error("boom");
      },
    });
    const ack = adapter.onRequest(buildRequest("run-1", "interrupt", {}));
    expect(ack.state).toBe("rejected");
    expect(ack.detail).toContain("boom");
  });
});

describe("piControlAdapter", () => {
  it("reports interrupt as unsupported", () => {
    const adapter = piControlAdapter("run-1");
    const caps = adapter.capabilities();
    expect(caps.backend).toBe("pi");
    expect(caps.interrupt.supported).toBe(false);
    expect(caps.guidance.supported).toBe(true);
    expect(caps.inspect.supported).toBe(true);
  });

  it("ignores interrupt requests", () => {
    const adapter = piControlAdapter("run-1");
    const ack = adapter.onRequest(buildRequest("run-1", "interrupt", {}));
    expect(ack.state).toBe("ignored");
  });

  it("applies guide with durable-guidance ack even when interrupt requested", () => {
    const adapter = piControlAdapter("run-1");
    const ack = adapter.onRequest(
      buildRequest("run-1", "guide", {
        message: "hello",
        interrupt: true,
      }),
    );
    expect(ack.state).toBe("applied");
    expect(ack.detail).toContain("interrupt ignored");
  });
});
