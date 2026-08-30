import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryPlugin } from "../src/memory-plugin.js";
import {
  DEFAULT_MEMORY_KIND,
  listMemoryPluginKinds,
  registerMemoryPlugin,
  resetMemoryPlugins,
  resolveMemoryPlugin,
  resolveMemoryPluginForProject,
} from "../src/memory-plugin.js";

const tmpDir = join(import.meta.dirname ?? ".", ".tmp-memory-plugin-test");

function recordingPlugin(kind: string): MemoryPlugin & { calls: string[] } {
  const calls: string[] = [];
  const empty = { preferences: [], learnings: [], meta: [] };
  return {
    kind,
    calls,
    addLearning: () => {
      calls.push("addLearning");
    },
    addPreference: () => {
      calls.push("addPreference");
    },
    addMeta: () => {
      calls.push("addMeta");
    },
    addRunLearning: () => {
      calls.push("addRunLearning");
    },
    addRunMeta: () => {
      calls.push("addRunMeta");
    },
    remove: () => {
      calls.push("remove");
    },
    removeFromEither: () => {
      calls.push("removeFromEither");
    },
    promote: () => {
      calls.push("promote");
    },
    list: () => {
      calls.push("list");
      return "recording-list";
    },
    find: () => {
      calls.push("find");
      return "recording-find";
    },
    status: () => {
      calls.push("status");
      return "recording-status";
    },
    render: () => {
      calls.push("render");
      return "recording-render";
    },
    stats: () => {
      calls.push("stats");
      return {
        project: empty,
        run: empty,
        combinedRenderedChars: 0,
        budgetChars: 0,
        truncated: false,
      };
    },
    statsProject: () => {
      calls.push("statsProject");
      return {
        preferences: 0,
        learnings: 0,
        meta: 0,
        totalEntries: 0,
        renderedChars: 0,
        budgetChars: 0,
        truncated: false,
      };
    },
    raw: () => {
      calls.push("raw");
      return "";
    },
    compact: () => {
      calls.push("compact");
      return { scanned: 0, duplicatesRemoved: 0, ids: [] };
    },
    prune: () => {
      calls.push("prune");
      return { scanned: 0, pruned: 0, ids: [] };
    },
  };
}

beforeEach(() => {
  resetMemoryPlugins();
  mkdirSync(tmpDir, { recursive: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  resetMemoryPlugins();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("memory plugin registry", () => {
  it("defaults empty kind to jsonl", () => {
    expect(resolveMemoryPlugin().kind).toBe(DEFAULT_MEMORY_KIND);
    expect(resolveMemoryPlugin("").kind).toBe("jsonl");
    expect(resolveMemoryPlugin("  ").kind).toBe("jsonl");
  });

  it("ships jsonl and file builtins", () => {
    expect(listMemoryPluginKinds()).toEqual(["file", "jsonl"]);
    expect(resolveMemoryPlugin("file").kind).toBe("file");
  });

  it("registers a second plugin without replacing jsonl", () => {
    const stub = recordingPlugin("recording");
    registerMemoryPlugin(stub);
    expect(resolveMemoryPlugin("recording")).toBe(stub);
    expect(resolveMemoryPlugin("jsonl").kind).toBe("jsonl");
    expect(stub.calls).toEqual([]);
    expect(resolveMemoryPlugin("recording").list(tmpDir)).toBe(
      "recording-list",
    );
    expect(stub.calls).toEqual(["list"]);
  });

  it("rejects an empty kind on register", () => {
    expect(() => registerMemoryPlugin(recordingPlugin("  "))).toThrow(
      "memory plugin kind is required",
    );
  });

  it("throws on an unknown kind", () => {
    expect(() => resolveMemoryPlugin("mem0")).toThrow(
      "unknown memory plugin kind: mem0",
    );
  });

  it("loads an external module from memory.module", () => {
    const fixture = join(
      import.meta.dirname ?? ".",
      "fixtures",
      "external-memory-plugin.cjs",
    );
    writeFileSync(
      join(tmpDir, "autoloops.toml"),
      `[memory]\nkind = "honcho"\nmodule = "${fixture}"\n`,
    );
    const plugin = resolveMemoryPluginForProject(tmpDir);
    expect(plugin.kind).toBe("honcho");
    expect(plugin.list(tmpDir)).toBe("external-list");
    expect(plugin.render("", "", 0)).toBe("external-render");
    plugin.addLearning(tmpDir, "from honcho", "manual");
    const loaded = createRequire(import.meta.url)(fixture) as {
      calls: string[];
      resetCalls: () => void;
    };
    expect(loaded.calls).toContain("addLearning:from honcho");
    expect(loaded.calls).toContain("list");
    expect(loaded.calls).toContain("render");
    loaded.resetCalls();
  });

  it("rejects a missing memory.module path", () => {
    writeFileSync(
      join(tmpDir, "autoloops.toml"),
      '[memory]\nkind = "honcho"\nmodule = "./no-such-plugin.cjs"\n',
    );
    expect(() => resolveMemoryPluginForProject(tmpDir)).toThrow(
      "failed to load memory plugin module",
    );
  });

  it("resolves kind from project config", () => {
    const stub = recordingPlugin("recording");
    registerMemoryPlugin(stub);
    writeFileSync(
      join(tmpDir, "autoloops.toml"),
      '[memory]\nkind = "recording"\n',
    );
    expect(resolveMemoryPluginForProject(tmpDir).kind).toBe("recording");
  });
});

describe("jsonl memory plugin", () => {
  it("adds a learning and preference, then lists and renders them", () => {
    const saved = process.env.AUTOLOOP_MEMORY_FILE;
    const memFile = join(tmpDir, "memory.jsonl");
    process.env.AUTOLOOP_MEMORY_FILE = memFile;
    try {
      const plugin = resolveMemoryPlugin("jsonl");
      plugin.addLearning(tmpDir, "use vitest", "manual");
      plugin.addPreference(tmpDir, "Workflow", "run tests first");
      const listed = plugin.list(tmpDir);
      expect(listed).toContain("Loop memory:");
      expect(listed).toContain("use vitest");
      expect(listed).toContain("run tests first");
      expect(listed).toContain("[Workflow]");
      const rendered = plugin.render(
        memFile,
        join(tmpDir, "missing-run.jsonl"),
        0,
      );
      expect(rendered).toContain("Loop memory:");
      expect(rendered).toContain("Project memory:");
      expect(rendered).toContain("use vitest");
      expect(rendered).toContain("run tests first");
      const raw = readFileSync(memFile, "utf-8");
      expect(raw).toContain('"type": "learning"');
      expect(raw).toContain('"type": "preference"');
    } finally {
      if (saved === undefined) delete process.env.AUTOLOOP_MEMORY_FILE;
      else process.env.AUTOLOOP_MEMORY_FILE = saved;
    }
  });

  it("file kind uses the same jsonl store", () => {
    const saved = process.env.AUTOLOOP_MEMORY_FILE;
    const memFile = join(tmpDir, "memory.jsonl");
    process.env.AUTOLOOP_MEMORY_FILE = memFile;
    try {
      const plugin = resolveMemoryPlugin("file");
      plugin.addLearning(tmpDir, "file plugin lesson", "manual");
      expect(plugin.list(tmpDir)).toContain("file plugin lesson");
    } finally {
      if (saved === undefined) delete process.env.AUTOLOOP_MEMORY_FILE;
      else process.env.AUTOLOOP_MEMORY_FILE = saved;
    }
  });

  it("lists, finds, and statuses both tiers when stateDir is set", () => {
    const saved = process.env.AUTOLOOP_MEMORY_FILE;
    const memFile = join(tmpDir, "memory.jsonl");
    const runDir = join(tmpDir, "run");
    process.env.AUTOLOOP_MEMORY_FILE = memFile;
    try {
      const plugin = resolveMemoryPlugin("jsonl");
      plugin.addPreference(tmpDir, "Style", "tabs");
      plugin.addRunLearning(runDir, "run-only lesson", "manual");
      const listed = plugin.list(tmpDir, runDir);
      expect(listed).toContain("Project memory:");
      expect(listed).toContain("Run memory:");
      expect(listed).toContain("tabs");
      expect(listed).toContain("run-only lesson");
      expect(plugin.find(tmpDir, "tabs", runDir)).toContain("preference");
      expect(plugin.find(tmpDir, "run-only", runDir)).toContain("learning");
      expect(plugin.find(tmpDir, "no-such-entry", runDir)).toContain(
        "No active memory entries matching",
      );
      expect(plugin.find(tmpDir, "tabs")).toContain("preference");
      const status = plugin.status(tmpDir, runDir);
      expect(status).toContain("entries active");
      expect(status).toContain("run:");
      expect(plugin.status(tmpDir)).toContain("Memory:");
      expect(plugin.raw(tmpDir)).toContain("tabs");
      expect(plugin.statsProject(tmpDir, 8000).preferences).toBe(1);
      expect(
        plugin.stats(memFile, join(runDir, "memory.jsonl"), 8000).run.learnings,
      ).toHaveLength(1);
    } finally {
      if (saved === undefined) delete process.env.AUTOLOOP_MEMORY_FILE;
      else process.env.AUTOLOOP_MEMORY_FILE = saved;
    }
  });
});
