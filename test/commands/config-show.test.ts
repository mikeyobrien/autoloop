import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dispatchConfig } from "../../src/commands/config.js";

const TMP_BASE = join(tmpdir(), "autoloop-ts-test-config-show-" + process.pid);

function tmpDir(name: string): string {
  const dir = join(TMP_BASE, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function captureLogs(fn: () => void): string {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  try {
    fn();
  } finally {
    console.log = origLog;
  }
  return logs.join("\n");
}

beforeEach(() => mkdirSync(TMP_BASE, { recursive: true }));
afterEach(() => rmSync(TMP_BASE, { recursive: true, force: true }));

describe("dispatchConfig", () => {
  const origEnv = process.env["AUTOLOOP_CONFIG"];
  afterEach(() => {
    if (origEnv === undefined) delete process.env["AUTOLOOP_CONFIG"];
    else process.env["AUTOLOOP_CONFIG"] = origEnv;
  });

  it("show prints resolved config with per-key provenance", () => {
    process.env["AUTOLOOP_CONFIG"] = join(TMP_BASE, "nonexistent.toml");
    const dir = tmpDir("show-project");
    writeFileSync(
      join(dir, "autoloops.toml"),
      '[backend]\nkind = "command"\ncommand = "claude"\n',
    );

    const output = captureLogs(() => dispatchConfig(["show", "--project", dir]));
    // Per-key provenance annotations on individual key lines
    expect(output).toContain('command = "claude"');
    expect(output).toContain("# project");
    expect(output).toContain("[core]");
    expect(output).toContain("# default");
  });

  it("show with user config shows user provenance per key", () => {
    const userCfgPath = join(TMP_BASE, "user.toml");
    writeFileSync(userCfgPath, '[memory]\nprompt_budget_chars = "16000"\n');
    process.env["AUTOLOOP_CONFIG"] = userCfgPath;

    const dir = tmpDir("show-user");

    const output = captureLogs(() => dispatchConfig(["show", "--project", dir]));
    expect(output).toContain('prompt_budget_chars = "16000"');
    expect(output).toContain("# user");
  });

  it("show --json outputs valid JSON with config and provenance", () => {
    process.env["AUTOLOOP_CONFIG"] = join(TMP_BASE, "nonexistent.toml");
    const dir = tmpDir("show-json");
    writeFileSync(
      join(dir, "autoloops.toml"),
      '[backend]\ncommand = "claude"\n',
    );

    const output = captureLogs(() => dispatchConfig(["show", "--json", "--project", dir]));
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("config");
    expect(parsed).toHaveProperty("provenance");
    expect(parsed.config.backend.command).toBe("claude");
    expect(parsed.provenance["backend.command"]).toContain("project");
    expect(parsed.provenance["backend.kind"]).toBe("default");
  });

  it("path prints user config path and existence", () => {
    const userCfgPath = join(TMP_BASE, "user-path.toml");
    writeFileSync(userCfgPath, "[backend]\n");
    process.env["AUTOLOOP_CONFIG"] = userCfgPath;

    const output = captureLogs(() => dispatchConfig(["path"]));
    expect(output).toContain(userCfgPath);
    expect(output).toContain("exists: yes");
  });

  it("path reports non-existent file", () => {
    const missingPath = join(TMP_BASE, "no-such-file.toml");
    process.env["AUTOLOOP_CONFIG"] = missingPath;

    const output = captureLogs(() => dispatchConfig(["path"]));
    expect(output).toContain(missingPath);
    expect(output).toContain("exists: no");
  });

  it("prints usage for --help", () => {
    const output = captureLogs(() => dispatchConfig(["--help"]));
    expect(output).toContain("config <subcommand>");
    expect(output).toContain("path");
    expect(output).toContain("--json");
  });

  it("prints usage for unknown subcommand", () => {
    const output = captureLogs(() => dispatchConfig(["bogus"]));
    expect(output).toContain("unknown config subcommand");
  });
});
