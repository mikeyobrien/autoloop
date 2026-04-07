import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addRunLearning,
  addRunMeta,
  promote,
  removeFromEither,
  renderFile,
  renderTwoTier,
  statsFile,
  statsTwoTier,
} from "../src/memory.js";

const tmpDir = join(import.meta.dirname ?? ".", ".tmp-memory-test");
const memFile = join(tmpDir, "memory.jsonl");

function writeMem(lines: string[]) {
  writeFileSync(memFile, `${lines.join("\n")}\n`, "utf-8");
}

function memLine(id: string, type: string, extra: string): string {
  return `{"id": "${id}", "type": "${type}", ${extra}}`;
}

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("memory materialize via renderFile", () => {
  it("returns empty string for empty file", () => {
    writeMem([]);
    expect(renderFile(memFile, 0)).toBe("");
  });

  it("renders preferences", () => {
    writeMem([
      memLine("mem-1", "preference", '"category": "style", "text": "use tabs"'),
    ]);
    const result = renderFile(memFile, 0);
    expect(result).toContain("Preferences:");
    expect(result).toContain("[mem-1]");
    expect(result).toContain("use tabs");
  });

  it("renders learnings with source", () => {
    writeMem([
      memLine(
        "mem-1",
        "learning",
        '"text": "vitest is fast", "source": "test run"',
      ),
    ]);
    const result = renderFile(memFile, 0);
    expect(result).toContain("Learnings:");
    expect(result).toContain("(test run)");
    expect(result).toContain("vitest is fast");
  });

  it("renders meta entries", () => {
    writeMem([memLine("meta-1", "meta", '"key": "version", "value": "1.0"')]);
    const result = renderFile(memFile, 0);
    expect(result).toContain("Meta:");
    expect(result).toContain("version: 1.0");
  });

  it("deduplicates entries by id (last write wins)", () => {
    writeMem([
      memLine("mem-1", "learning", '"text": "old text", "source": "s"'),
      memLine("mem-1", "learning", '"text": "new text", "source": "s"'),
    ]);
    const result = renderFile(memFile, 0);
    expect(result).toContain("new text");
    expect(result).not.toContain("old text");
  });

  it("tombstones remove entries", () => {
    writeMem([
      memLine("mem-1", "learning", '"text": "doomed", "source": "s"'),
      `{"id": "ts-1", "type": "tombstone", "target_id": "mem-1", "reason": "stale"}`,
    ]);
    const result = renderFile(memFile, 0);
    expect(result).not.toContain("doomed");
  });

  it("deduplicates meta entries by key (last write wins)", () => {
    writeMem([
      memLine("meta-1", "meta", '"key": "lang", "value": "python"'),
      memLine("meta-2", "meta", '"key": "lang", "value": "typescript"'),
    ]);
    const result = renderFile(memFile, 0);
    expect(result).toContain("typescript");
    expect(result).not.toContain("python");
  });

  it("skips lines without id", () => {
    writeMem(['{"type": "learning", "text": "no id"}']);
    const result = renderFile(memFile, 0);
    expect(result).toBe("");
  });
});

describe("memory statsFile", () => {
  it("counts entries correctly", () => {
    writeMem([
      memLine("mem-1", "preference", '"category": "c", "text": "t"'),
      memLine("mem-2", "learning", '"text": "l", "source": "s"'),
      memLine("meta-1", "meta", '"key": "k", "value": "v"'),
    ]);
    const stats = statsFile(memFile, 1000);
    expect(stats.preferences).toBe(1);
    expect(stats.learnings).toBe(1);
    expect(stats.meta).toBe(1);
    expect(stats.totalEntries).toBe(3);
    expect(stats.truncated).toBe(false);
  });

  it("reports truncated when rendered exceeds budget", () => {
    writeMem([
      memLine(
        "mem-1",
        "learning",
        '"text": "a very long learning entry that takes up space", "source": "s"',
      ),
    ]);
    const stats = statsFile(memFile, 10);
    expect(stats.truncated).toBe(true);
  });

  it("returns zeros for missing file", () => {
    const stats = statsFile(join(tmpDir, "nonexistent.jsonl"), 1000);
    expect(stats.totalEntries).toBe(0);
  });
});

const runDir = join(tmpDir, "run");
const runFile = join(runDir, "memory.jsonl");
const projFile = memFile; // alias for clarity

function writeRun(lines: string[]) {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(runFile, `${lines.join("\n")}\n`, "utf-8");
}

describe("addRunLearning", () => {
  it("writes to stateDir memory file", () => {
    addRunLearning(runDir, "run lesson", "manual");
    const content = readFileSync(runFile, "utf-8");
    expect(content).toContain('"type": "learning"');
    expect(content).toContain("run lesson");
  });
});

describe("addRunMeta", () => {
  it("writes to stateDir memory file", () => {
    addRunMeta(runDir, "iteration", "5");
    const content = readFileSync(runFile, "utf-8");
    expect(content).toContain('"type": "meta"');
    expect(content).toContain("iteration");
  });
});

describe("renderTwoTier", () => {
  it("shows both sections when both tiers populated", () => {
    writeMem([
      memLine("mem-1", "preference", '"category": "c", "text": "proj pref"'),
    ]);
    writeRun([
      memLine("mem-1", "learning", '"text": "run lesson", "source": "manual"'),
    ]);
    const result = renderTwoTier(projFile, runFile, 0);
    expect(result).toContain("Project memory:");
    expect(result).toContain("Run memory:");
    expect(result).toContain("proj pref");
    expect(result).toContain("run lesson");
  });

  it("omits Run memory section when run is empty", () => {
    writeMem([
      memLine("mem-1", "learning", '"text": "proj only", "source": "s"'),
    ]);
    writeRun([]);
    const result = renderTwoTier(projFile, runFile, 0);
    expect(result).toContain("Project memory:");
    expect(result).not.toContain("Run memory:");
  });

  it("omits Project memory section when project is empty", () => {
    writeMem([]);
    writeRun([
      memLine("mem-1", "learning", '"text": "run only", "source": "s"'),
    ]);
    const result = renderTwoTier(projFile, runFile, 0);
    expect(result).not.toContain("Project memory:");
    expect(result).toContain("Run memory:");
  });

  it("returns empty string when both tiers empty", () => {
    writeMem([]);
    writeRun([]);
    expect(renderTwoTier(projFile, runFile, 0)).toBe("");
  });

  it("truncation drops run memory entries first", () => {
    writeMem([
      memLine("mem-1", "preference", '"category": "c", "text": "keep this"'),
    ]);
    writeRun([
      memLine(
        "mem-1",
        "learning",
        '"text": "this should be dropped because run memory comes after project", "source": "s"',
      ),
    ]);
    // Use a budget that fits project but not run
    const full = renderTwoTier(projFile, runFile, 0);
    const projOnly = renderTwoTier(projFile, runFile, 0).split(
      "Run memory:",
    )[0];
    const budget = projOnly.length + 10; // just enough for project section
    const result = renderTwoTier(projFile, runFile, budget);
    expect(result).toContain("keep this");
    expect(result).toContain("memory truncated");
  });
});

describe("statsTwoTier", () => {
  it("returns combined stats for both tiers", () => {
    writeMem([memLine("mem-1", "preference", '"category": "c", "text": "t"')]);
    writeRun([
      memLine("mem-1", "learning", '"text": "l", "source": "s"'),
      memLine("meta-1", "meta", '"key": "k", "value": "v"'),
    ]);
    const stats = statsTwoTier(projFile, runFile, 8000);
    expect(stats.project.preferences).toHaveLength(1);
    expect(stats.run.learnings).toHaveLength(1);
    expect(stats.run.meta).toHaveLength(1);
    expect(stats.combinedRenderedChars).toBeGreaterThan(0);
    expect(stats.truncated).toBe(false);
  });
});

describe("promote", () => {
  it("copies learning to project and tombstones in run", () => {
    writeMem([]);
    writeRun([
      memLine("mem-1", "learning", '"text": "promote me", "source": "manual"'),
    ]);
    const origEnv = process.env.AUTOLOOP_MEMORY_FILE;
    process.env.AUTOLOOP_MEMORY_FILE = projFile;
    try {
      promote(tmpDir, runDir, "mem-1");
    } finally {
      process.env.AUTOLOOP_MEMORY_FILE = origEnv;
    }
    // Project should have the promoted learning
    const projContent = readFileSync(projFile, "utf-8");
    expect(projContent).toContain("promote me");
    expect(projContent).toContain('"source": "promoted"');
    // Run should have tombstone
    const runContent = readFileSync(runFile, "utf-8");
    expect(runContent).toContain("tombstone");
    expect(runContent).toContain("promoted");
  });

  it("rejects non-learning entries", () => {
    writeMem([]);
    writeRun([memLine("meta-1", "meta", '"key": "k", "value": "v"')]);
    const origEnv = process.env.AUTOLOOP_MEMORY_FILE;
    process.env.AUTOLOOP_MEMORY_FILE = projFile;
    try {
      promote(tmpDir, runDir, "meta-1");
    } finally {
      process.env.AUTOLOOP_MEMORY_FILE = origEnv;
    }
    // Project should remain empty (writeMem wrote empty, no promoted entry added)
    const projContent = readFileSync(projFile, "utf-8");
    expect(projContent).not.toContain("learning");
  });
});

describe("removeFromEither", () => {
  it("removes from run when entry exists there", () => {
    writeMem([
      memLine("mem-1", "learning", '"text": "proj entry", "source": "s"'),
    ]);
    writeRun([
      memLine("mem-1", "learning", '"text": "run entry", "source": "s"'),
    ]);
    const origEnv = process.env.AUTOLOOP_MEMORY_FILE;
    process.env.AUTOLOOP_MEMORY_FILE = projFile;
    try {
      removeFromEither(tmpDir, runDir, "mem-1", "test");
    } finally {
      process.env.AUTOLOOP_MEMORY_FILE = origEnv;
    }
    const runContent = readFileSync(runFile, "utf-8");
    expect(runContent).toContain("tombstone");
    // Project should NOT have a tombstone
    const projContent = readFileSync(projFile, "utf-8");
    expect(projContent).not.toContain("tombstone");
  });

  it("removes from project when not in run", () => {
    writeMem([
      memLine("mem-1", "learning", '"text": "proj entry", "source": "s"'),
    ]);
    writeRun([]);
    const origEnv = process.env.AUTOLOOP_MEMORY_FILE;
    process.env.AUTOLOOP_MEMORY_FILE = projFile;
    try {
      removeFromEither(tmpDir, runDir, "mem-1", "test");
    } finally {
      process.env.AUTOLOOP_MEMORY_FILE = origEnv;
    }
    const projContent = readFileSync(projFile, "utf-8");
    expect(projContent).toContain("tombstone");
  });
});
