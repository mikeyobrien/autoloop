import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as config from "@mobrienv/autoloop-core/config";
import { loadTopology } from "@mobrienv/autoloop-core/topology";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchInit } from "../../src/commands/init.js";

describe("init", () => {
  let dir: string;
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "autoloop-init-test-"));
    logs = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.join(" "));
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  describe("project init", () => {
    it("writes a parseable starter autoloops.toml with next steps", () => {
      dispatchInit([dir]);
      const path = join(dir, "autoloops.toml");
      expect(existsSync(path)).toBe(true);

      const cfg = config.load(path);
      expect(config.get(cfg, "event_loop.max_iterations", "")).toBe("3");
      expect(config.get(cfg, "event_loop.completion_event", "")).toBe(
        "task.complete",
      );
      expect(config.get(cfg, "event_loop.completion_promise", "")).toBe(
        "LOOP_COMPLETE",
      );
      expect(config.get(cfg, "event_loop.stall_iterations", "")).toBe("0");
      expect(config.get(cfg, "event_loop.max_cost_usd", "")).toBe("0");
      expect(config.get(cfg, "backend.command", "")).toBe("claude");
      expect(config.get(cfg, "backend.timeout_ms", "")).toBe("300000");
      expect(config.get(cfg, "memory.prompt_budget_chars", "")).toBe("8000");

      const out = logs.join("\n");
      expect(out).toContain(`created ${path}`);
      expect(out).toContain("autoloop run autocode");
      expect(out).toContain("autoloop list");
      expect(out).toContain("autoloop doctor");
    });

    it("never overwrites an existing autoloops.toml", () => {
      const path = join(dir, "autoloops.toml");
      writeFileSync(path, "# custom\n");
      dispatchInit([dir]);
      expect(readFileSync(path, "utf-8")).toBe("# custom\n");
      expect(logs.join("\n")).toContain(`${path} already exists, skipped`);
    });

    it("creates .gitignore with .autoloop/ in a git repo", () => {
      mkdirSync(join(dir, ".git"));
      dispatchInit([dir]);
      expect(readFileSync(join(dir, ".gitignore"), "utf-8")).toBe(
        ".autoloop/\n",
      );
    });

    it("appends .autoloop/ to an existing .gitignore without duplicating", () => {
      mkdirSync(join(dir, ".git"));
      writeFileSync(join(dir, ".gitignore"), "node_modules/"); // no trailing \n
      dispatchInit([dir]);
      const text = readFileSync(join(dir, ".gitignore"), "utf-8");
      expect(text).toBe("node_modules/\n.autoloop/\n");

      dispatchInit([dir]); // re-run must not duplicate
      const again = readFileSync(join(dir, ".gitignore"), "utf-8");
      expect(again.match(/\.autoloop\//g)).toHaveLength(1);
      expect(logs.join("\n")).toContain("already ignores .autoloop/");
    });

    it("does not create .gitignore outside a git repo", () => {
      dispatchInit([dir]);
      expect(existsSync(join(dir, ".gitignore"))).toBe(false);
    });

    it("defaults the directory argument to '.'", () => {
      const prev = process.cwd();
      process.chdir(dir);
      try {
        dispatchInit([]);
      } finally {
        process.chdir(prev);
      }
      expect(existsSync(join(dir, "autoloops.toml"))).toBe(true);
    });
  });

  describe("preset scaffold", () => {
    it("scaffolds a preset that config and topology parsers accept", () => {
      dispatchInit(["--preset", "myloop", dir]);
      const presetDir = join(dir, "presets", "myloop");
      for (const f of [
        "autoloops.toml",
        "harness.md",
        "topology.toml",
        "README.md",
        join("roles", "builder.md"),
        join("roles", "critic.md"),
      ]) {
        expect(existsSync(join(presetDir, f)), `${f} should exist`).toBe(true);
      }

      // Leading description comment for `autoloop list`.
      const toml = readFileSync(join(presetDir, "autoloops.toml"), "utf-8");
      expect(toml.startsWith("# myloop — ")).toBe(true);

      // Config must load through the real parser.
      const cfg = config.load(join(presetDir, "autoloops.toml"));
      expect(config.get(cfg, "event_loop.completion_event", "")).toBe(
        "task.complete",
      );
      expect(config.get(cfg, "harness.instructions_file", "")).toBe(
        "harness.md",
      );
      expect(config.projectHasConfig(presetDir)).toBe(true);

      // Topology must load through the real parser with both roles wired.
      const topology = loadTopology(presetDir);
      expect(topology.name).toBe("myloop");
      expect(topology.completion).toBe("task.complete");
      expect(topology.roles.map((r) => r.id)).toEqual(["builder", "critic"]);
      expect(topology.handoff["loop.start"]).toEqual(["builder"]);
      expect(topology.handoff["review.ready"]).toEqual(["critic"]);
      expect(topology.handoff["review.rejected"]).toEqual(["builder"]);
      // Role prompts resolve from prompt_file on disk.
      expect(topology.roles[0].prompt).toContain("builder");
      expect(topology.roles[1].emits).toContain("task.complete");

      expect(logs.join("\n")).toContain(
        'autoloop run ./presets/myloop "describe your objective"',
      );
    });

    it("re-running skips every existing file without overwriting", () => {
      dispatchInit(["--preset", "myloop", dir]);
      const harness = join(dir, "presets", "myloop", "harness.md");
      writeFileSync(harness, "customized\n");
      logs.length = 0;
      dispatchInit(["--preset", "myloop", dir]);
      expect(readFileSync(harness, "utf-8")).toBe("customized\n");
      const skips = logs.filter((l) => l.includes("already exists, skipped"));
      expect(skips).toHaveLength(6);
    });

    it("rejects preset names with path separators", () => {
      dispatchInit(["--preset", "../evil", dir]);
      expect(errors.join("\n")).toContain("invalid preset name");
      expect(process.exitCode).toBe(1);
      expect(existsSync(join(dir, "presets"))).toBe(false);
    });

    it("errors when --preset has no name", () => {
      dispatchInit(["--preset"]);
      expect(errors.join("\n")).toContain("--preset requires a name");
      expect(process.exitCode).toBe(1);
    });
  });

  it("prints usage with --help", () => {
    dispatchInit(["--help"]);
    expect(logs.join("\n")).toContain("Usage: autoloop init");
    expect(logs.join("\n")).toContain("--preset");
  });

  it("errors politely on unknown flags", () => {
    dispatchInit(["--bogus", dir]);
    expect(errors.join("\n")).toContain("unknown flag `--bogus`");
    expect(errors.join("\n")).toContain("--help");
    expect(process.exitCode).toBe(1);
    expect(existsSync(join(dir, "autoloops.toml"))).toBe(false);
  });

  it("errors on extra positional arguments", () => {
    dispatchInit([dir, "extra"]);
    expect(errors.join("\n")).toContain("at most one directory");
    expect(process.exitCode).toBe(1);
  });
});
