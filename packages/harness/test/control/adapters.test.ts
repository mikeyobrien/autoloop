import { describe, expect, it, vi } from "vitest";
import {
  acpControlAdapter,
  kiroControlAdapter,
} from "../../src/control/acp-adapter.js";
import { claudeSdkControlAdapter } from "../../src/control/claude-sdk-adapter.js";
import { commandControlAdapter } from "../../src/control/command-adapter.js";
import { piControlAdapter } from "../../src/control/pi-adapter.js";
import { buildRequest } from "../../src/control/queue.js";

describe("acpControlAdapter", () => {
  it("reports interrupt as supported for any ACP provider", () => {
    const adapter = acpControlAdapter("run-1", "claude-agent-acp", {
      triggerInterrupt: () => {},
    });
    const caps = adapter.capabilities();
    expect(caps.backend).toBe("acp:claude-agent-acp");
    expect(caps.interrupt.supported).toBe(true);
    expect(caps.interrupt.detail).toContain("ACP cancel");
    expect(caps.guidance.supported).toBe(true);
    expect(caps.inspect.supported).toBe(true);
  });

  it("keeps kiroControlAdapter as a legacy alias", () => {
    const adapter = kiroControlAdapter("run-1", { triggerInterrupt: () => {} });
    expect(adapter.capabilities().backend).toBe("acp:kiro");
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
  function makeHooks() {
    return { triggerInterrupt: vi.fn(), triggerSteer: vi.fn() };
  }

  it("reports interrupt and live-steer guidance as supported", () => {
    const adapter = piControlAdapter("run-1", makeHooks());
    const caps = adapter.capabilities();
    expect(caps.backend).toBe("pi");
    expect(caps.interrupt.supported).toBe(true);
    expect(caps.interrupt.detail).toContain("pi RPC abort");
    expect(caps.guidance.supported).toBe(true);
    expect(caps.guidance.detail).toContain("live steer");
    expect(caps.inspect.supported).toBe(true);
  });

  it("invokes triggerInterrupt on interrupt verb", () => {
    const hooks = makeHooks();
    const adapter = piControlAdapter("run-1", hooks);
    const ack = adapter.onRequest(buildRequest("run-1", "interrupt", {}));
    expect(hooks.triggerInterrupt).toHaveBeenCalledTimes(1);
    expect(ack.state).toBe("applied");
    expect(ack.detail).toContain("pi abort sent");
  });

  it("invokes interrupt when guide payload requests it", () => {
    const hooks = makeHooks();
    const adapter = piControlAdapter("run-1", hooks);
    const ack = adapter.onRequest(
      buildRequest("run-1", "guide", {
        message: "pivot",
        interrupt: true,
      }),
    );
    expect(hooks.triggerInterrupt).toHaveBeenCalledTimes(1);
    expect(hooks.triggerSteer).not.toHaveBeenCalled();
    expect(ack.state).toBe("applied");
    expect(ack.detail).toContain("guidance-driven");
  });

  it("steers guidance into the live turn when interrupt is not requested", () => {
    const hooks = makeHooks();
    const adapter = piControlAdapter("run-1", hooks);
    const ack = adapter.onRequest(
      buildRequest("run-1", "guide", {
        message: "focus on tests",
        interrupt: false,
      }),
    );
    expect(hooks.triggerInterrupt).not.toHaveBeenCalled();
    expect(hooks.triggerSteer).toHaveBeenCalledWith("focus on tests");
    expect(ack.state).toBe("applied");
    expect(ack.detail).toContain("steered into live turn");
  });

  it("still applies guidance when live steering throws", () => {
    const hooks = makeHooks();
    hooks.triggerSteer.mockImplementation(() => {
      throw new Error("session gone");
    });
    const adapter = piControlAdapter("run-1", hooks);
    const ack = adapter.onRequest(
      buildRequest("run-1", "guide", {
        message: "still durable",
        interrupt: false,
      }),
    );
    expect(ack.state).toBe("applied");
    expect(ack.detail).toContain("live steer unavailable");
  });

  it("applies guidance without steering when the message is empty", () => {
    const hooks = makeHooks();
    const adapter = piControlAdapter("run-1", hooks);
    const ack = adapter.onRequest(
      buildRequest("run-1", "guide", { message: "", interrupt: false }),
    );
    expect(hooks.triggerSteer).not.toHaveBeenCalled();
    expect(ack.state).toBe("applied");
  });

  it("ignores unknown verbs", () => {
    const adapter = piControlAdapter("run-1", makeHooks());
    const ack = adapter.onRequest(
      buildRequest("run-1", "inspect" as never, {}),
    );
    expect(ack.state).toBe("ignored");
  });

  it("reports rejected when the abort hook throws", () => {
    const hooks = makeHooks();
    hooks.triggerInterrupt.mockImplementation(() => {
      throw new Error("rpc gone");
    });
    const adapter = piControlAdapter("run-1", hooks);
    const ack = adapter.onRequest(buildRequest("run-1", "interrupt", {}));
    expect(ack.state).toBe("rejected");
    expect(ack.detail).toContain("rpc gone");
  });
});

describe("claudeSdkControlAdapter", () => {
  function makeHooks() {
    return { triggerInterrupt: vi.fn(), triggerSteer: vi.fn() };
  }

  it("reports interrupt and live-steer guidance as supported", () => {
    const adapter = claudeSdkControlAdapter("run-1", makeHooks());
    const caps = adapter.capabilities();
    expect(caps.backend).toBe("claude-sdk");
    expect(caps.interrupt.supported).toBe(true);
    expect(caps.interrupt.detail).toContain("SDK interrupt()");
    expect(caps.guidance.supported).toBe(true);
    expect(caps.guidance.detail).toContain("live steer");
    expect(caps.inspect.supported).toBe(true);
  });

  it("invokes triggerInterrupt on interrupt verb", () => {
    const hooks = makeHooks();
    const adapter = claudeSdkControlAdapter("run-1", hooks);
    const ack = adapter.onRequest(buildRequest("run-1", "interrupt", {}));
    expect(hooks.triggerInterrupt).toHaveBeenCalledTimes(1);
    expect(ack.state).toBe("applied");
    expect(ack.detail).toContain("SDK interrupt sent");
  });

  it("invokes interrupt when guide payload requests it", () => {
    const hooks = makeHooks();
    const adapter = claudeSdkControlAdapter("run-1", hooks);
    const ack = adapter.onRequest(
      buildRequest("run-1", "guide", {
        message: "pivot",
        interrupt: true,
      }),
    );
    expect(hooks.triggerInterrupt).toHaveBeenCalledTimes(1);
    expect(hooks.triggerSteer).not.toHaveBeenCalled();
    expect(ack.state).toBe("applied");
    expect(ack.detail).toContain("guidance-driven");
  });

  it("steers guidance into the live turn when interrupt is not requested", () => {
    const hooks = makeHooks();
    const adapter = claudeSdkControlAdapter("run-1", hooks);
    const ack = adapter.onRequest(
      buildRequest("run-1", "guide", {
        message: "focus on tests",
        interrupt: false,
      }),
    );
    expect(hooks.triggerInterrupt).not.toHaveBeenCalled();
    expect(hooks.triggerSteer).toHaveBeenCalledWith("focus on tests");
    expect(ack.state).toBe("applied");
    expect(ack.detail).toContain("steered into live turn");
  });

  it("still applies guidance when live steering throws", () => {
    const hooks = makeHooks();
    hooks.triggerSteer.mockImplementation(() => {
      throw new Error("session gone");
    });
    const adapter = claudeSdkControlAdapter("run-1", hooks);
    const ack = adapter.onRequest(
      buildRequest("run-1", "guide", {
        message: "still durable",
        interrupt: false,
      }),
    );
    expect(ack.state).toBe("applied");
    expect(ack.detail).toContain("live steer unavailable");
  });

  it("applies guidance without steering when the message is empty", () => {
    const hooks = makeHooks();
    const adapter = claudeSdkControlAdapter("run-1", hooks);
    const ack = adapter.onRequest(
      buildRequest("run-1", "guide", { message: "", interrupt: false }),
    );
    expect(hooks.triggerSteer).not.toHaveBeenCalled();
    expect(ack.state).toBe("applied");
  });

  it("ignores unknown verbs", () => {
    const adapter = claudeSdkControlAdapter("run-1", makeHooks());
    const ack = adapter.onRequest(
      buildRequest("run-1", "inspect" as never, {}),
    );
    expect(ack.state).toBe("ignored");
  });

  it("reports rejected when the interrupt hook throws", () => {
    const hooks = makeHooks();
    hooks.triggerInterrupt.mockImplementation(() => {
      throw new Error("query gone");
    });
    const adapter = claudeSdkControlAdapter("run-1", hooks);
    const ack = adapter.onRequest(buildRequest("run-1", "interrupt", {}));
    expect(ack.state).toBe("rejected");
    expect(ack.detail).toContain("query gone");
  });
});

describe("commandControlAdapter", () => {
  function makeHooks() {
    return { triggerInterrupt: vi.fn() };
  }

  it("reports interrupt supported and no live-steering guidance", () => {
    const adapter = commandControlAdapter("run-1", makeHooks());
    const caps = adapter.capabilities();
    expect(caps.backend).toBe("command");
    expect(caps.interrupt.supported).toBe(true);
    expect(caps.interrupt.detail).toContain("SIGUSR1");
    expect(caps.guidance.supported).toBe(true);
    expect(caps.guidance.detail).toContain("journal-durable");
    expect(caps.inspect.supported).toBe(true);
  });

  it("invokes triggerInterrupt on interrupt verb", () => {
    const hooks = makeHooks();
    const adapter = commandControlAdapter("run-1", hooks);
    const ack = adapter.onRequest(buildRequest("run-1", "interrupt", {}));
    expect(hooks.triggerInterrupt).toHaveBeenCalledTimes(1);
    expect(ack.state).toBe("applied");
    expect(ack.detail).toContain("signal sent");
  });

  it("invokes interrupt when guide payload requests it", () => {
    const hooks = makeHooks();
    const adapter = commandControlAdapter("run-1", hooks);
    const ack = adapter.onRequest(
      buildRequest("run-1", "guide", {
        message: "pivot",
        interrupt: true,
      }),
    );
    expect(hooks.triggerInterrupt).toHaveBeenCalledTimes(1);
    expect(ack.state).toBe("applied");
    expect(ack.detail).toContain("guidance-driven");
  });

  it("acks journal-durable guidance without interrupting when not requested", () => {
    const hooks = makeHooks();
    const adapter = commandControlAdapter("run-1", hooks);
    const ack = adapter.onRequest(
      buildRequest("run-1", "guide", {
        message: "later",
        interrupt: false,
      }),
    );
    expect(hooks.triggerInterrupt).not.toHaveBeenCalled();
    expect(ack.state).toBe("applied");
    expect(ack.detail).toContain("guidance appended");
  });

  it("ignores unknown verbs", () => {
    const adapter = commandControlAdapter("run-1", makeHooks());
    const ack = adapter.onRequest(
      buildRequest("run-1", "inspect" as never, {}),
    );
    expect(ack.state).toBe("ignored");
  });

  it("reports rejected when the interrupt hook throws", () => {
    const hooks = makeHooks();
    hooks.triggerInterrupt.mockImplementation(() => {
      throw new Error("no pid");
    });
    const adapter = commandControlAdapter("run-1", hooks);
    const ack = adapter.onRequest(buildRequest("run-1", "interrupt", {}));
    expect(ack.state).toBe("rejected");
    expect(ack.detail).toContain("no pid");
  });
});
