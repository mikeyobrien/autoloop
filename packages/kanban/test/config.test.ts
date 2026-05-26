import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_KANBAN_CONFIG,
  kanbanConfigPath,
  loadKanbanConfig,
} from "../src/config.js";

describe("kanban config", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "autoloop-kanban-config-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("returns defaults when file does not exist", () => {
    const missing = join(dir, "nonexistent.toml");
    const cfg = loadKanbanConfig(missing);
    expect(cfg).toEqual(DEFAULT_KANBAN_CONFIG);
    // Must be a fresh object so callers can mutate safely.
    expect(cfg).not.toBe(DEFAULT_KANBAN_CONFIG);
    expect(cfg.hooks).not.toBe(DEFAULT_KANBAN_CONFIG.hooks);
  });

  it("parses known keys and overlays them onto defaults", () => {
    const path = join(dir, "kanban.toml");
    writeFileSync(
      path,
      [
        'default_preset = "demo"',
        "stall_timeout_ms = 1234",
        "",
        "[max_concurrent_by_column]",
        "in_progress = 4",
        "",
        "[hooks]",
        'before_run = "echo hi"',
        'after_run = ""',
        "timeout_ms = 2000",
        "",
      ].join("\n"),
    );
    const cfg = loadKanbanConfig(path);
    expect(cfg.defaultPreset).toBe("demo");
    expect(cfg.stallTimeoutMs).toBe(1234);
    expect(cfg.maxConcurrentByColumn).toEqual({ in_progress: 4 });
    expect(cfg.hooks.before_run).toBe("echo hi");
    expect(cfg.hooks.after_run).toBe("");
    expect(cfg.hooks.timeout_ms).toBe(2000);
  });

  it("ignores unknown keys", () => {
    const path = join(dir, "kanban.toml");
    writeFileSync(
      path,
      ['mystery_key = "ignored"', 'default_preset = "keeper"', ""].join("\n"),
    );
    const cfg = loadKanbanConfig(path);
    expect(cfg.defaultPreset).toBe("keeper");
    expect(cfg.stallTimeoutMs).toBe(DEFAULT_KANBAN_CONFIG.stallTimeoutMs);
    expect(cfg.hooks).toEqual(DEFAULT_KANBAN_CONFIG.hooks);
    expect(
      (cfg as unknown as Record<string, unknown>).mystery_key,
    ).toBeUndefined();
  });

  it("honors AUTOLOOP_KANBAN_CONFIG env override", () => {
    const override = join(dir, "override.toml");
    vi.stubEnv("AUTOLOOP_KANBAN_CONFIG", override);
    expect(kanbanConfigPath()).toBe(override);
  });

  it("honors XDG_CONFIG_HOME when AUTOLOOP_KANBAN_CONFIG is unset", () => {
    vi.stubEnv("AUTOLOOP_KANBAN_CONFIG", "");
    vi.stubEnv("XDG_CONFIG_HOME", dir);
    expect(kanbanConfigPath()).toBe(join(dir, "autoloop", "kanban.toml"));
  });

  it("returns defaults on parse error", () => {
    const path = join(dir, "broken.toml");
    writeFileSync(path, "this is = = not valid toml\n[[[\n");
    mkdirSync(join(dir, "sink"), { recursive: true });
    const cfg = loadKanbanConfig(path);
    expect(cfg).toEqual(DEFAULT_KANBAN_CONFIG);
  });
});
