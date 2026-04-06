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

beforeEach(() => mkdirSync(TMP_BASE, { recursive: true }));
afterEach(() => rmSync(TMP_BASE, { recursive: true, force: true }));

describe("dispatchConfig", () => {
  const origEnv = process.env["AUTOLOOP_CONFIG"];
  afterEach(() => {
    if (origEnv === undefined) delete process.env["AUTOLOOP_CONFIG"];
    else process.env["AUTOLOOP_CONFIG"] = origEnv;
  });

  it("show prints resolved config with provenance labels", () => {
    process.env["AUTOLOOP_CONFIG"] = join(TMP_BASE, "nonexistent.toml");
    const dir = tmpDir("show-project");
    writeFileSync(
      join(dir, "autoloops.toml"),
      '[backend]\nkind = "command"\ncommand = "claude"\n',
    );

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      dispatchConfig(["show", "--project", dir]);
    } finally {
      console.log = origLog;
    }

    const output = logs.join("\n");
    expect(output).toContain("[backend] (source: project");
    expect(output).toContain('command = "claude"');
    expect(output).toContain("[core] (source: default)");
  });

  it("show with user config shows user provenance", () => {
    const userCfgPath = join(TMP_BASE, "user.toml");
    writeFileSync(userCfgPath, '[memory]\nprompt_budget_chars = "16000"\n');
    process.env["AUTOLOOP_CONFIG"] = userCfgPath;

    const dir = tmpDir("show-user");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      dispatchConfig(["show", "--project", dir]);
    } finally {
      console.log = origLog;
    }

    const output = logs.join("\n");
    expect(output).toContain("[memory] (source: user");
    expect(output).toContain('prompt_budget_chars = "16000"');
  });

  it("prints usage for --help", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    try {
      dispatchConfig(["--help"]);
    } finally {
      console.log = origLog;
    }
    expect(logs.join("\n")).toContain("config <subcommand>");
  });

  it("prints usage for unknown subcommand", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    try {
      dispatchConfig(["bogus"]);
    } finally {
      console.log = origLog;
    }
    expect(logs.join("\n")).toContain("unknown config subcommand");
  });
});
