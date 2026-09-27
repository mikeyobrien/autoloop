import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoopEvent } from "@mobrienv/autoloop-harness/events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the onEvent dispatchRun hands the harness, and stand in for the herdr
// sink so we can assert it is teed in without spawning herdr.
const runSpy = vi.fn();
vi.mock("@mobrienv/autoloop-harness", () => ({
  run: (...args: unknown[]) => runSpy(...args),
}));
vi.mock("../../src/cli/event-printer.js", () => ({ cliPrintEvent: vi.fn() }));

const herdr = { onEvent: vi.fn(), release: vi.fn(), close: vi.fn() };
const herdrEventSink = vi.fn();
vi.mock("../../src/cli/herdr-sink.js", () => ({
  herdrEventSink: () => herdrEventSink(),
}));

import { dispatchRun } from "../../src/commands/run.js";

const dir = join(tmpdir(), `autoloop-run-herdr-${process.pid}`);
const event: LoopEvent = { type: "log", level: "info", message: "hi" };

beforeEach(() => {
  vi.clearAllMocks();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "autoloops.toml"),
    "[event_loop]\nmax_iterations = 1\n",
  );
  runSpy.mockImplementation(async (...args: unknown[]) => {
    (args[3] as { onEvent: (e: LoopEvent) => void }).onEvent(event);
    return { stopReason: "completed", iterations: 1 };
  });
});

afterEach(() => {
  process.exitCode = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe("dispatchRun herdr wiring", () => {
  it("tees events into the herdr sink and closes it at a normal exit", async () => {
    herdrEventSink.mockReturnValue(herdr);
    await dispatchRun([dir, "fix"], [], dir, "autoloop");
    expect(herdr.onEvent).toHaveBeenCalledWith(event);
    expect(herdr.close).toHaveBeenCalled();
    expect(herdr.release).not.toHaveBeenCalled();
  });

  it("runs normally when not inside herdr", async () => {
    herdrEventSink.mockReturnValue(undefined);
    await dispatchRun([dir, "fix"], [], dir, "autoloop");
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(herdr.onEvent).not.toHaveBeenCalled();
  });

  it("releases the pane before re-raising an interrupt", async () => {
    herdrEventSink.mockReturnValue(herdr);
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    runSpy.mockImplementation(async () => {
      process.emit("SIGINT", "SIGINT");
      return { stopReason: "interrupted", iterations: 0 };
    });
    await dispatchRun([dir, "fix"], [], dir, "autoloop");
    expect(herdr.release).toHaveBeenCalled();
    expect(kill).toHaveBeenCalledWith(process.pid, "SIGINT");
    expect(herdr.release.mock.invocationCallOrder[0]).toBeLessThan(
      kill.mock.invocationCallOrder[0],
    );
    kill.mockRestore();
  });
});
