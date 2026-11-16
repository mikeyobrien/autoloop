import { describe, expect, it, vi } from "vitest";
import {
  loadNodePty,
  NODE_PTY_PACKAGE,
  type NodePtyModule,
  startTmuxSession,
  tmuxMissingMessage,
} from "../src/spawn.js";

describe("loadNodePty", () => {
  it("returns the module from the require function", () => {
    const mod = { spawn: vi.fn() } as unknown as NodePtyModule;
    const requireFn = vi.fn(() => mod);
    expect(loadNodePty(requireFn)).toBe(mod);
    expect(requireFn).toHaveBeenCalledWith(NODE_PTY_PACKAGE);
  });

  it("throws a clear error when the optional dependency is missing", () => {
    const requireFn = () => {
      throw new Error(`Cannot find module '${NODE_PTY_PACKAGE}'`);
    };
    expect(() => loadNodePty(requireFn)).toThrow(
      /kanban terminals need the optional dependency @homebridge\/node-pty-prebuilt-multiarch.*Cannot find module.*rest of autoloop works without it/,
    );
  });

  it("reports non-Error throw values", () => {
    const requireFn = () => {
      throw "boom";
    };
    expect(() => loadNodePty(requireFn)).toThrow(
      /could not be loaded \(boom\)/,
    );
  });
});

describe("tmuxMissingMessage", () => {
  it("says kanban terminals are not supported on native Windows", () => {
    const msg = tmuxMissingMessage("win32");
    expect(msg).toMatch(/not available on native Windows/);
    expect(msg).toMatch(/WSL/);
  });

  it("asks POSIX users to install tmux", () => {
    expect(tmuxMissingMessage("linux")).toMatch(/Install tmux/);
  });
});

describe("startTmuxSession", () => {
  const args = ["kanban-t1", "/work", 80, 24, "autoloop run x"] as const;

  it("creates the session through the injected runner", () => {
    const newSession = vi.fn();
    const available = vi.fn(() => true);
    startTmuxSession(...args, { newSession, available, platform: "linux" });
    expect(newSession).toHaveBeenCalledWith(...args);
    expect(available).not.toHaveBeenCalled();
  });

  it("replaces the shell error with the tmux message when tmux is missing", () => {
    const newSession = vi.fn(() => {
      throw new Error("'tmux' is not recognized as an internal command");
    });
    expect(() =>
      startTmuxSession(...args, {
        newSession,
        available: () => false,
        platform: "win32",
      }),
    ).toThrow(tmuxMissingMessage("win32"));
  });

  it("rethrows the original error when tmux is available", () => {
    const original = new Error("duplicate session");
    const newSession = vi.fn(() => {
      throw original;
    });
    expect(() =>
      startTmuxSession(...args, {
        newSession,
        available: () => true,
        platform: "linux",
      }),
    ).toThrow(original);
  });
});
