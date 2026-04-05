import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLoopContext, injectClaudePermissions } from "../../src/harness/config-helpers.js";

function makeProject(configToml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-ts-config-helpers-"));
  writeFileSync(join(dir, "autoloops.toml"), configToml);
  writeFileSync(join(dir, "topology.toml"), "[[role]]\nname = \"builder\"\n");
  mkdirSync(join(dir, ".autoloop"), { recursive: true });
  return dir;
}

describe("injectClaudePermissions", () => {
  it("adds Claude permissions flags for Claude command backends", () => {
    expect(injectClaudePermissions("claude", [])).toEqual(["-p", "--dangerously-skip-permissions"]);
    expect(injectClaudePermissions("/opt/tools/claude", [])).toEqual([
      "-p",
      "--dangerously-skip-permissions",
    ]);
  });

  it("does not duplicate Claude permissions flags", () => {
    expect(injectClaudePermissions("claude", ["-p", "--dangerously-skip-permissions"])).toEqual([
      "-p",
      "--dangerously-skip-permissions",
    ]);
  });

  it("leaves non-Claude backends untouched", () => {
    expect(injectClaudePermissions("node", ["script.js"])).toEqual(["script.js"]);
  });
});

describe("buildLoopContext", () => {
  it("injects Claude permissions for config-defined Claude backends", () => {
    const projectDir = makeProject([
      'event_loop.max_iterations = 1',
      'backend.kind = "command"',
      'backend.command = "claude"',
      'backend.timeout_ms = 3000000',
    ].join("\n"));

    const loop = buildLoopContext(projectDir, "test objective", "node dist/main.js", { workDir: projectDir });

    expect(loop.backend.command).toBe("claude");
    expect(loop.backend.args).toEqual(["-p", "--dangerously-skip-permissions"]);
    expect(loop.review.args).toEqual(["-p", "--dangerously-skip-permissions"]);
  });
});