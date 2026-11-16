import type { KillTreeDeps } from "@mobrienv/autoloop-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { terminateCommandChild } from "../../src/command-teardown.js";

function fakeKillDeps(platform: NodeJS.Platform): KillTreeDeps {
  return {
    platform,
    killGroup: vi.fn(),
    taskkill: vi.fn(() => 0),
  };
}

describe("terminateCommandChild", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends SIGTERM to the child pid (not its group) on POSIX", () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const deps = fakeKillDeps("linux");
    terminateCommandChild(4321, deps);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(4321, "SIGTERM");
    expect(deps.killGroup).not.toHaveBeenCalled();
    expect(deps.taskkill).not.toHaveBeenCalled();
  });

  it("ignores a child that already exited on POSIX", () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
    });
    expect(() =>
      terminateCommandChild(4321, fakeKillDeps("darwin")),
    ).not.toThrow();
  });

  it("kills the whole process tree on win32", () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const deps = fakeKillDeps("win32");
    terminateCommandChild(4321, deps);
    expect(deps.taskkill).toHaveBeenCalledWith(4321);
    expect(kill).not.toHaveBeenCalled();
  });

  it("uses the current platform when no deps are given", () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    if (process.platform === "win32") {
      // A pid that cannot exist: taskkill fails, nothing throws.
      expect(() => terminateCommandChild(2 ** 30)).not.toThrow();
      expect(kill).not.toHaveBeenCalled();
    } else {
      terminateCommandChild(4321);
      expect(kill).toHaveBeenCalledWith(4321, "SIGTERM");
    }
  });
});
