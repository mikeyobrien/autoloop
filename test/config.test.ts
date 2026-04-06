import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { load, get, getInt, getList, put, loadProject, projectHasConfig, userConfigPath, hasUserConfig, loadUserConfig, loadLayered, defaults } from "../src/config.js";

const TMP_BASE = join(tmpdir(), "autoloop-ts-test-config-" + process.pid);

function tmpDir(name: string): string {
  const dir = join(TMP_BASE, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => mkdirSync(TMP_BASE, { recursive: true }));
afterEach(() => rmSync(TMP_BASE, { recursive: true, force: true }));

describe("load", () => {
  it("returns defaults for missing file", () => {
    const cfg = load("/nonexistent/path/autoloops.toml");
    expect(get(cfg, "event_loop.max_iterations", "0")).toBe("3");
    expect(get(cfg, "backend.kind", "")).toBe("pi");
  });

  it("parses TOML config", () => {
    const dir = tmpDir("toml");
    writeFileSync(
      join(dir, "config.toml"),
      "[event_loop]\nmax_iterations = 10\ncompletion_event = \"done\"\n\n[backend]\ncommand = \"claude\"\nkind = \"command\"\n",
    );
    const cfg = load(join(dir, "config.toml"));
    expect(get(cfg, "event_loop.max_iterations", "0")).toBe("10");
    expect(get(cfg, "event_loop.completion_event", "")).toBe("done");
    expect(get(cfg, "backend.command", "")).toBe("claude");
    expect(get(cfg, "backend.kind", "")).toBe("command");
  });

  it("handles list values in brackets", () => {
    const dir = tmpDir("list");
    writeFileSync(
      join(dir, "config.toml"),
      '[event_loop]\nrequired_events = ["review.passed", "tasks.ready"]\n',
    );
    const cfg = load(join(dir, "config.toml"));
    expect(getList(cfg, "event_loop.required_events")).toEqual([
      "review.passed",
      "tasks.ready",
    ]);
  });

  it("skips comments and blank lines", () => {
    const dir = tmpDir("comments");
    writeFileSync(
      join(dir, "config.toml"),
      "# comment\n\n[backend]\n# another comment\ncommand = \"pi\"\n",
    );
    const cfg = load(join(dir, "config.toml"));
    expect(get(cfg, "backend.command", "")).toBe("pi");
  });
});

describe("get", () => {
  it("returns fallback for missing key", () => {
    const cfg = load("/nonexistent");
    expect(get(cfg, "nonexistent.key", "default")).toBe("default");
  });

  it("returns value for existing key", () => {
    const cfg = load("/nonexistent");
    expect(get(cfg, "core.state_dir", "fallback")).toBe(".autoloop");
  });
});

describe("getInt", () => {
  it("returns integer value", () => {
    const cfg = load("/nonexistent");
    expect(getInt(cfg, "event_loop.max_iterations", 0)).toBe(3);
  });

  it("returns fallback for missing", () => {
    const cfg = load("/nonexistent");
    expect(getInt(cfg, "nonexistent", 42)).toBe(42);
  });
});

describe("put", () => {
  it("sets a top-level key", () => {
    const cfg = put({}, "name", "test");
    expect(get(cfg, "name", "")).toBe("test");
  });

  it("sets a nested key", () => {
    const cfg = put({}, "a.b.c", "deep");
    expect(get(cfg, "a.b.c", "")).toBe("deep");
  });

  it("preserves existing keys", () => {
    let cfg = put({}, "a.x", "1");
    cfg = put(cfg, "a.y", "2");
    expect(get(cfg, "a.x", "")).toBe("1");
    expect(get(cfg, "a.y", "")).toBe("2");
  });
});

describe("projectHasConfig", () => {
  it("returns true when autoloops.toml exists", () => {
    const dir = tmpDir("has-config");
    writeFileSync(join(dir, "autoloops.toml"), "[event_loop]\n");
    expect(projectHasConfig(dir)).toBe(true);
  });

  it("returns true when autoloops.conf exists", () => {
    const dir = tmpDir("has-conf");
    writeFileSync(join(dir, "autoloops.conf"), "[event_loop]\n");
    expect(projectHasConfig(dir)).toBe(true);
  });

  it("returns false when neither exists", () => {
    const dir = tmpDir("no-config");
    expect(projectHasConfig(dir)).toBe(false);
  });
});

describe("loadProject integration", () => {
  it("loads from autoloops.toml", () => {
    const dir = tmpDir("project");
    writeFileSync(
      join(dir, "autoloops.toml"),
      "[event_loop]\nmax_iterations = 5\ncompletion_event = \"task.complete\"\n",
    );
    const cfg = loadProject(dir);
    expect(getInt(cfg, "event_loop.max_iterations", 0)).toBe(5);
  });
});

describe("userConfigPath", () => {
  const origEnv = process.env["AUTOLOOP_CONFIG"];
  afterEach(() => {
    if (origEnv === undefined) delete process.env["AUTOLOOP_CONFIG"];
    else process.env["AUTOLOOP_CONFIG"] = origEnv;
  });

  it("returns AUTOLOOP_CONFIG env when set", () => {
    process.env["AUTOLOOP_CONFIG"] = "/custom/path/config.toml";
    expect(userConfigPath()).toBe("/custom/path/config.toml");
  });

  it("returns default path when env not set", () => {
    delete process.env["AUTOLOOP_CONFIG"];
    const path = userConfigPath();
    expect(path).toContain(".config/autoloop/config.toml");
  });
});

describe("hasUserConfig", () => {
  const origEnv = process.env["AUTOLOOP_CONFIG"];
  afterEach(() => {
    if (origEnv === undefined) delete process.env["AUTOLOOP_CONFIG"];
    else process.env["AUTOLOOP_CONFIG"] = origEnv;
  });

  it("returns false when file does not exist", () => {
    process.env["AUTOLOOP_CONFIG"] = join(TMP_BASE, "nonexistent.toml");
    expect(hasUserConfig()).toBe(false);
  });

  it("returns true when file exists", () => {
    const userCfgPath = join(TMP_BASE, "user-config.toml");
    writeFileSync(userCfgPath, "[backend]\nkind = \"command\"\n");
    process.env["AUTOLOOP_CONFIG"] = userCfgPath;
    expect(hasUserConfig()).toBe(true);
  });
});

describe("loadUserConfig", () => {
  const origEnv = process.env["AUTOLOOP_CONFIG"];
  afterEach(() => {
    if (origEnv === undefined) delete process.env["AUTOLOOP_CONFIG"];
    else process.env["AUTOLOOP_CONFIG"] = origEnv;
  });

  it("returns empty object when file missing", () => {
    process.env["AUTOLOOP_CONFIG"] = join(TMP_BASE, "nonexistent.toml");
    expect(loadUserConfig()).toEqual({});
  });

  it("parses user config file", () => {
    const userCfgPath = join(TMP_BASE, "user-cfg.toml");
    writeFileSync(userCfgPath, '[backend]\nkind = "command"\ncommand = "claude"\n');
    process.env["AUTOLOOP_CONFIG"] = userCfgPath;
    const cfg = loadUserConfig();
    expect((cfg["backend"] as Record<string, unknown>)["kind"]).toBe("command");
    expect((cfg["backend"] as Record<string, unknown>)["command"]).toBe("claude");
  });
});

describe("loadLayered", () => {
  const origEnv = process.env["AUTOLOOP_CONFIG"];
  afterEach(() => {
    if (origEnv === undefined) delete process.env["AUTOLOOP_CONFIG"];
    else process.env["AUTOLOOP_CONFIG"] = origEnv;
  });

  it("returns defaults when no user or project config", () => {
    process.env["AUTOLOOP_CONFIG"] = join(TMP_BASE, "nonexistent.toml");
    const dir = tmpDir("empty-project");
    const { config: cfg, provenance } = loadLayered(dir);
    expect(get(cfg, "backend.kind", "")).toBe("pi");
    expect(provenance["backend"]).toBe("default");
  });

  it("user config overrides defaults", () => {
    const userCfgPath = join(TMP_BASE, "user-layered.toml");
    writeFileSync(userCfgPath, '[backend]\nkind = "command"\ncommand = "claude"\n');
    process.env["AUTOLOOP_CONFIG"] = userCfgPath;
    const dir = tmpDir("no-project-cfg");
    const { config: cfg, provenance } = loadLayered(dir);
    expect(get(cfg, "backend.kind", "")).toBe("command");
    expect(get(cfg, "backend.command", "")).toBe("claude");
    expect(provenance["backend"]).toContain("user");
  });

  it("project config overrides user config", () => {
    const userCfgPath = join(TMP_BASE, "user-override.toml");
    writeFileSync(userCfgPath, '[backend]\nkind = "command"\ncommand = "claude"\n');
    process.env["AUTOLOOP_CONFIG"] = userCfgPath;

    const dir = tmpDir("project-override");
    writeFileSync(
      join(dir, "autoloops.toml"),
      '[backend]\nkind = "command"\ncommand = "custom-backend"\n',
    );

    const { config: cfg, provenance } = loadLayered(dir);
    expect(get(cfg, "backend.command", "")).toBe("custom-backend");
    expect(provenance["backend"]).toContain("project");
  });

  it("non-overlapping sections preserve their sources", () => {
    const userCfgPath = join(TMP_BASE, "user-partial.toml");
    writeFileSync(userCfgPath, '[memory]\nprompt_budget_chars = "16000"\n');
    process.env["AUTOLOOP_CONFIG"] = userCfgPath;

    const dir = tmpDir("project-partial");
    writeFileSync(
      join(dir, "autoloops.toml"),
      '[event_loop]\nmax_iterations = 10\n',
    );

    const { provenance } = loadLayered(dir);
    expect(provenance["memory"]).toContain("user");
    expect(provenance["event_loop"]).toContain("project");
    expect(provenance["backend"]).toBe("default");
  });

  it("loadProject returns layered config transparently", () => {
    const userCfgPath = join(TMP_BASE, "user-transparent.toml");
    writeFileSync(userCfgPath, '[backend]\nkind = "command"\ncommand = "claude"\n');
    process.env["AUTOLOOP_CONFIG"] = userCfgPath;

    const dir = tmpDir("project-transparent");
    writeFileSync(join(dir, "autoloops.toml"), "[event_loop]\nmax_iterations = 7\n");

    const cfg = loadProject(dir);
    // User config backend is picked up
    expect(get(cfg, "backend.command", "")).toBe("claude");
    // Project config is authoritative
    expect(getInt(cfg, "event_loop.max_iterations", 0)).toBe(7);
  });
});
