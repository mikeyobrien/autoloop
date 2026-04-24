import { buildCommandInvocation } from "@mobrienv/autoloop-harness/backend/run-command";
import { describe, expect, it } from "vitest";

describe("buildCommandInvocation", () => {
  it("builds arg-mode command with prompt as trailing argument", () => {
    const cmd = buildCommandInvocation(
      { command: "claude", args: ["--model", "opus"], promptMode: "arg" },
      "Fix the bug",
    );
    expect(cmd).toContain("'claude'");
    expect(cmd).toContain("'--model'");
    expect(cmd).toContain("'opus'");
    expect(cmd).toContain("'Fix the bug'");
    // arg mode: prompt is appended after command+args
    expect(cmd).not.toContain("|");
  });

  it("builds stdin-mode command with prompt piped via printf", () => {
    const cmd = buildCommandInvocation(
      { command: "claude", args: [], promptMode: "stdin" },
      "hello world",
    );
    expect(cmd).toContain("printf '%s'");
    expect(cmd).toContain("|");
    expect(cmd).toContain("'claude'");
  });

  it("shell-quotes prompt with special characters in arg mode", () => {
    const cmd = buildCommandInvocation(
      { command: "echo", args: [], promptMode: "arg" },
      'it\'s a "test" with $vars',
    );
    // The prompt should be quoted safely
    expect(cmd).toContain("echo");
    // Should not have unescaped double quotes or dollar signs that would expand
    expect(cmd).not.toMatch(/\$vars[^']/);
  });

  it("shell-quotes prompt with special characters in stdin mode", () => {
    const cmd = buildCommandInvocation(
      { command: "cat", args: [], promptMode: "stdin" },
      "line1\nline2",
    );
    expect(cmd).toContain("printf '%s'");
    expect(cmd).toContain("|");
  });

  it("handles empty args array", () => {
    const cmd = buildCommandInvocation(
      { command: "echo", args: [], promptMode: "arg" },
      "test",
    );
    expect(cmd).toContain("'echo'");
    expect(cmd).toContain("'test'");
  });

  it("handles multiple args correctly", () => {
    const cmd = buildCommandInvocation(
      { command: "node", args: ["-e", "console.log('hi')"], promptMode: "arg" },
      "prompt",
    );
    expect(cmd).toContain("'node'");
    expect(cmd).toContain("'-e'");
  });
});
