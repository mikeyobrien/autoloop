import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() =>
  vi.fn(() => ({ pid: 4242, unref: vi.fn() })),
);
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { armAutoResume, registryProjectRoot } from "../../src/auto-resume.js";
import type { LoopContext } from "../../src/types.js";

describe("registryProjectRoot", () => {
  it("returns the project dir of a POSIX registry path", () => {
    expect(registryProjectRoot("/work/proj/.autoloop/registry.jsonl")).toBe(
      "/work/proj",
    );
    expect(
      registryProjectRoot("/work/proj/.autoloop/registry.jsonl", "linux"),
    ).toBe("/work/proj");
  });

  it("does not treat backslashes as separators on POSIX", () => {
    expect(
      registryProjectRoot("/work/a\\b/.autoloop/registry.jsonl", "darwin"),
    ).toBe("/work/a\\b");
  });

  it("returns the project dir of a win32 registry path built with join", () => {
    expect(
      registryProjectRoot(
        "C:\\Users\\me\\proj\\.autoloop\\registry.jsonl",
        "win32",
      ),
    ).toBe("C:\\Users\\me\\proj");
  });

  it("accepts forward and mixed separators on win32", () => {
    expect(
      registryProjectRoot("C:/Users/me/proj/.autoloop/registry.jsonl", "win32"),
    ).toBe("C:/Users/me/proj");
    expect(
      registryProjectRoot(
        "C:/Users/me/proj\\.autoloop\\registry.jsonl",
        "win32",
      ),
    ).toBe("C:/Users/me/proj");
  });

  it("returns the input when it has no separator", () => {
    expect(registryProjectRoot("registry.jsonl", "win32")).toBe(
      "registry.jsonl",
    );
  });
});

describe("armAutoResume", () => {
  beforeEach(() => {
    spawnMock.mockClear();
  });

  const loop = {
    paths: {
      registryFile: "/work/proj/.autoloop/registry.jsonl",
      journalFile: "/work/proj/.autoloop/journal.jsonl",
      stateDir: "/work/proj/.autoloop",
    },
    runtime: { runId: "run-1", selfCommand: "autoloop", logLevel: "none" },
  } as unknown as LoopContext;

  it("spawns no sleeper for an indefinite park", () => {
    armAutoResume(loop, "w1", {
      name: "",
      reason: "",
      duration: "",
      durationMs: 0,
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("spawns a detached sleeper with no console window", () => {
    armAutoResume(loop, "w1", {
      name: "n",
      reason: "r",
      duration: "2s",
      durationMs: 2000,
    });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, args, options] = spawnMock.mock.calls[0] as unknown as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(options).toMatchObject({
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    const spec = JSON.parse(args[1]) as string[];
    expect(spec[5]).toBe("/work/proj");
  });
});
