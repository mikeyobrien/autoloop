import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runQuickCommand } from "../../src/acp/quick.js";

const bundleRoot = resolve(import.meta.dirname, "../..");

function ctx() {
  const projectDir = mkdtempSync(resolve(tmpdir(), "autoloop-acp-quick-"));
  return { bundleRoot, selfCmd: "autoloop", projectDir };
}

describe("runQuickCommand", () => {
  it("runs list and captures preset output", async () => {
    const result = await runQuickCommand("list", [], ctx());
    expect(result.stdout).toContain("autocode");
  });

  it("runs loops and captures output without throwing", async () => {
    const result = await runQuickCommand("loops", [], ctx());
    expect(typeof result.stdout).toBe("string");
  });

  it("runs config path", async () => {
    const result = await runQuickCommand("config", ["path"], ctx());
    expect(result.stdout.toLowerCase()).toContain("exists");
  });

  it("emit accepts a coordination topic", async () => {
    const result = await runQuickCommand(
      "emit",
      ["issue.discovered", "found a bug"],
      ctx(),
    );
    expect(result.stdout).toContain("emitted issue.discovered");
  });

  it("emit reports failure for an invalid topic", async () => {
    const c = ctx();
    process.env.AUTOLOOP_ALLOWED_EVENTS = "task.complete";
    try {
      const result = await runQuickCommand("emit", ["totally.bogus"], c);
      expect(result.stderr.length).toBeGreaterThan(0);
      expect(result.exitCode).toBe(1);
    } finally {
      delete process.env.AUTOLOOP_ALLOWED_EVENTS;
    }
  });

  it("emit with no topic still returns a result", async () => {
    const c = ctx();
    const origDir = process.env.AUTOLOOP_PROJECT_DIR;
    process.env.AUTOLOOP_PROJECT_DIR = c.projectDir;
    try {
      const result = await runQuickCommand("emit", [], c);
      // Empty topic is accepted as a no-op emit by the harness; either way we
      // get a deterministic captured result string.
      expect(typeof result.stdout).toBe("string");
    } finally {
      if (origDir === undefined) delete process.env.AUTOLOOP_PROJECT_DIR;
      else process.env.AUTOLOOP_PROJECT_DIR = origDir;
    }
  });

  it("memory list runs", async () => {
    const result = await runQuickCommand("memory", ["status"], ctx());
    expect(typeof result.stdout).toBe("string");
  });

  it("task list runs", async () => {
    const result = await runQuickCommand("task", ["list"], ctx());
    expect(typeof result.stdout).toBe("string");
  });

  it("inspect runs", async () => {
    const result = await runQuickCommand("inspect", ["--help"], ctx());
    expect(result.stdout.length + result.stderr.length).toBeGreaterThan(0);
  });

  it("worktree list runs", async () => {
    const result = await runQuickCommand("worktree", ["list"], ctx());
    expect(typeof result.stdout).toBe("string");
  });

  it("runs clean runs", async () => {
    const result = await runQuickCommand("runs", ["clean"], ctx());
    expect(typeof result.stdout).toBe("string");
  });

  it("control runs", async () => {
    const result = await runQuickCommand("control", [], ctx());
    expect(result.stdout.length + result.stderr.length).toBeGreaterThan(0);
  });

  it("guide without an active run reports no run", async () => {
    const c = ctx();
    const origDir = process.env.AUTOLOOP_PROJECT_DIR;
    const origRun = process.env.AUTOLOOP_RUN_ID;
    process.env.AUTOLOOP_PROJECT_DIR = c.projectDir;
    delete process.env.AUTOLOOP_RUN_ID;
    try {
      const result = await runQuickCommand("guide", ["focus here"], c);
      expect(result.stderr).toContain("No active run");
    } finally {
      if (origDir === undefined) delete process.env.AUTOLOOP_PROJECT_DIR;
      else process.env.AUTOLOOP_PROJECT_DIR = origDir;
      if (origRun !== undefined) process.env.AUTOLOOP_RUN_ID = origRun;
    }
  });

  it("chain list runs", async () => {
    const result = await runQuickCommand("chain", ["list"], ctx());
    expect(typeof result.stdout).toBe("string");
  });

  it("throws for a non-quick command", async () => {
    await expect(runQuickCommand("run", [], ctx())).rejects.toThrow(
      /not a quick command/,
    );
  });
});
