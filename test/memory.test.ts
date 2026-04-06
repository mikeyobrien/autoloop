import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderFile, statsFile } from "../src/memory.js";

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
