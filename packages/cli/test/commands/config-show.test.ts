import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchConfig } from "../../src/commands/config.js";

const TMP_BASE = join(tmpdir(), `autoloop-ts-test-config-show-${process.pid}`);

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
  const origEnv = process.env.AUTOLOOP_CONFIG;
  const origXdg = process.env.XDG_CONFIG_HOME;
  const origCwd = process.cwd();
  afterEach(() => {
    if (origEnv === undefined) delete process.env.AUTOLOOP_CONFIG;
    else process.env.AUTOLOOP_CONFIG = origEnv;
    if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = origXdg;
    process.chdir(origCwd);
  });

  it("show prints resolved config with per-key provenance", () => {
    process.env.AUTOLOOP_CONFIG = join(TMP_BASE, "nonexistent.toml");
    const dir = tmpDir("show-project");
    writeFileSync(
      join(dir, "autoloops.toml"),
      '[backend]\nkind = "command"\ncommand = "claude"\n',
    );

    const output = captureLogs(() =>
      dispatchConfig(["show", "--project", dir]),
    );
    // Per-key provenance annotations on individual key lines
    expect(output).toContain('command = "claude"');
    expect(output).toContain("# project");
    expect(output).toContain("[core]");
    expect(output).toContain("# default");
  });

  it("show with user config shows user provenance per key", () => {
    const userCfgPath = join(TMP_BASE, "user.toml");
    writeFileSync(userCfgPath, '[memory]\nprompt_budget_chars = "16000"\n');
    process.env.AUTOLOOP_CONFIG = userCfgPath;

    const dir = tmpDir("show-user");

    const output = captureLogs(() =>
      dispatchConfig(["show", "--project", dir]),
    );
    expect(output).toContain('prompt_budget_chars = "16000"');
    expect(output).toContain("# user");
  });

  it("show --json outputs valid JSON with config and provenance", () => {
    process.env.AUTOLOOP_CONFIG = join(TMP_BASE, "nonexistent.toml");
    const dir = tmpDir("show-json");
    writeFileSync(
      join(dir, "autoloops.toml"),
      '[backend]\ncommand = "claude"\n',
    );

    const output = captureLogs(() =>
      dispatchConfig(["show", "--json", "--project", dir]),
    );
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("config");
    expect(parsed).toHaveProperty("provenance");
    expect(parsed.config.backend.command).toBe("claude");
    expect(parsed.provenance["backend.command"]).toContain("project");
    expect(parsed.provenance["backend.kind"]).toBe("default");
  });

  it("config set writes user-scoped preset overrides", () => {
    process.env.AUTOLOOP_CONFIG = join(TMP_BASE, "missing-user-config.toml");
    process.env.XDG_CONFIG_HOME = join(TMP_BASE, "xdg-set-user");

    const output = captureLogs(() =>
      dispatchConfig([
        "set",
        "--user",
        "--preset",
        "autocode",
        "event_loop.max_iterations=250",
      ]),
    );

    const path = join(
      process.env.XDG_CONFIG_HOME,
      "autoloop",
      "overrides",
      "autocode.toml",
    );
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("[event_loop]");
    expect(content).toContain('max_iterations = "250"');
    expect(output).toContain(path);
  });

  it("config set writes repo-scoped preset overrides", () => {
    process.env.AUTOLOOP_CONFIG = join(TMP_BASE, "missing-repo-config.toml");
    const repoDir = tmpDir("repo-set");

    const output = captureLogs(() =>
      dispatchConfig([
        "set",
        "--repo",
        "--project",
        repoDir,
        "--preset",
        "autocode",
        "event_loop.max_iterations=300",
      ]),
    );

    const path = join(repoDir, ".autoloop", "overrides", "autocode.toml");
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("[event_loop]");
    expect(content).toContain('max_iterations = "300"');
    expect(output).toContain(path);
  });

  it("show --preset includes preset override provenance", () => {
    process.env.AUTOLOOP_CONFIG = join(TMP_BASE, "missing-show-preset.toml");
    process.env.XDG_CONFIG_HOME = join(TMP_BASE, "xdg-show-preset");
    const repoDir = tmpDir("repo-show-preset");
    mkdirSync(join(repoDir, "presets", "autocode"), { recursive: true });
    writeFileSync(
      join(repoDir, "presets", "autocode", "autoloops.toml"),
      "[event_loop]\nmax_iterations = 100\n",
    );
    const overridePath = join(
      repoDir,
      ".autoloop",
      "overrides",
      "autocode.toml",
    );
    mkdirSync(join(overridePath, ".."), { recursive: true });
    writeFileSync(overridePath, "[event_loop]\nmax_iterations = 400\n");

    const output = captureLogs(() =>
      dispatchConfig([
        "show",
        "--project",
        repoDir,
        "--preset",
        "autocode",
        "--explain",
      ]),
    );

    expect(output).toContain('max_iterations = "400"');
    expect(output).toContain("# repo override");
  });

  it("path prints user config path and existence", () => {
    const userCfgPath = join(TMP_BASE, "user-path.toml");
    writeFileSync(userCfgPath, "[backend]\n");
    process.env.AUTOLOOP_CONFIG = userCfgPath;

    const output = captureLogs(() => dispatchConfig(["path"]));
    expect(output).toContain(userCfgPath);
    expect(output).toContain("exists: yes");
  });

  it("path reports non-existent file", () => {
    const missingPath = join(TMP_BASE, "no-such-file.toml");
    process.env.AUTOLOOP_CONFIG = missingPath;

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
