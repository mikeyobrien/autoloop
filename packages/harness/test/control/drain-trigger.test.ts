import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTROL_POLL_INTERVAL_MS,
  installControlDrainTrigger,
} from "../../src/control/drain-trigger.js";

describe("installControlDrainTrigger", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("listens for SIGUSR1 on POSIX", () => {
    const drain = vi.fn();
    const stop = installControlDrainTrigger(drain, "linux");
    try {
      expect(process.listeners("SIGUSR1")).toContain(drain);
      stop();
      // POSIX keeps the listener (the historical behavior); stop is a no-op.
      expect(process.listeners("SIGUSR1")).toContain(drain);
    } finally {
      process.removeListener("SIGUSR1", drain);
    }
  });

  it("polls the control queue on a timer of at most 1 s on win32", () => {
    expect(CONTROL_POLL_INTERVAL_MS).toBeLessThanOrEqual(1000);
    vi.useFakeTimers();
    const drain = vi.fn();
    const stop = installControlDrainTrigger(drain, "win32");
    expect(process.listeners("SIGUSR1")).not.toContain(drain);

    vi.advanceTimersByTime(CONTROL_POLL_INTERVAL_MS - 1);
    expect(drain).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(drain).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CONTROL_POLL_INTERVAL_MS * 3);
    expect(drain).toHaveBeenCalledTimes(4);

    stop();
    vi.advanceTimersByTime(CONTROL_POLL_INTERVAL_MS * 5);
    expect(drain).toHaveBeenCalledTimes(4);
  });

  it("does not keep the process alive on win32 (unref'd timer)", () => {
    const unref = vi.fn();
    const clear = vi.spyOn(globalThis, "clearInterval");
    const set = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue({ unref } as unknown as ReturnType<typeof setInterval>);
    try {
      const stop = installControlDrainTrigger(vi.fn(), "win32");
      expect(set).toHaveBeenCalledWith(
        expect.any(Function),
        CONTROL_POLL_INTERVAL_MS,
      );
      expect(unref).toHaveBeenCalled();
      stop();
      expect(clear).toHaveBeenCalled();
    } finally {
      set.mockRestore();
      clear.mockRestore();
    }
  });
});
