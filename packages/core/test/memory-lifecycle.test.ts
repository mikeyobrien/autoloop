import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compactMemory, pruneMemory, renderFile } from "../src/memory.js";

const tmpDir = join(import.meta.dirname ?? ".", ".tmp-memory-lifecycle-test");
const memFile = join(tmpDir, ".autoloop", "memory.jsonl");

function writeMem(lines: string[]) {
  mkdirSync(join(tmpDir, ".autoloop"), { recursive: true });
  writeFileSync(memFile, `${lines.join("\n")}\n`, "utf-8");
}

function memLine(id: string, type: string, extra: string): string {
  return `{"id": "${id}", "type": "${type}", ${extra}}`;
}

function learning(id: string, text: string, created?: string): string {
  const createdField = created ? `, "created": "${created}"` : "";
  return memLine(
    id,
    "learning",
    `"text": "${text}", "source": "s"${createdField}`,
  );
}

let savedMemoryFileEnv: string | undefined;

beforeEach(() => {
  savedMemoryFileEnv = process.env.AUTOLOOP_MEMORY_FILE;
  delete process.env.AUTOLOOP_MEMORY_FILE;
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (savedMemoryFileEnv === undefined) {
    delete process.env.AUTOLOOP_MEMORY_FILE;
  } else {
    process.env.AUTOLOOP_MEMORY_FILE = savedMemoryFileEnv;
  }
  vi.useRealTimers();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("compactMemory", () => {
  it("tombstones duplicate learnings, keeping the oldest", () => {
    writeMem([
      learning("mem-1", "always run lint"),
      learning("mem-2", "always run lint"),
      learning("mem-3", "always run lint"),
      learning("mem-4", "unrelated lesson"),
    ]);
    const summary = compactMemory(tmpDir);
    expect(summary.scanned).toBe(4);
    expect(summary.duplicatesRemoved).toBe(2);
    expect(summary.ids).toEqual(["mem-2", "mem-3"]);
    const rendered = renderFile(memFile, 0);
    expect(rendered).toContain("[mem-1]");
    expect(rendered).not.toContain("[mem-2]");
    expect(rendered).not.toContain("[mem-3]");
    expect(rendered).toContain("[mem-4]");
  });

  it("normalizes whitespace when comparing texts", () => {
    writeMem([
      learning("mem-1", "always run lint"),
      learning("mem-2", "  always   run lint  "),
    ]);
    const summary = compactMemory(tmpDir);
    expect(summary.duplicatesRemoved).toBe(1);
    expect(summary.ids).toEqual(["mem-2"]);
  });

  it("is case-sensitive", () => {
    writeMem([
      learning("mem-1", "always run lint"),
      learning("mem-2", "Always Run Lint"),
    ]);
    const summary = compactMemory(tmpDir);
    expect(summary.duplicatesRemoved).toBe(0);
    expect(summary.ids).toEqual([]);
  });

  it("ignores already-tombstoned entries", () => {
    writeMem([
      learning("mem-1", "always run lint"),
      learning("mem-2", "always run lint"),
      `{"id": "ts-1", "type": "tombstone", "target_id": "mem-1", "reason": "stale"}`,
    ]);
    // mem-1 is tombstoned, so mem-2 is the only active copy: no duplicates.
    const summary = compactMemory(tmpDir);
    expect(summary.scanned).toBe(1);
    expect(summary.duplicatesRemoved).toBe(0);
    const rendered = renderFile(memFile, 0);
    expect(rendered).toContain("[mem-2]");
  });

  it("does not collapse preferences or meta with matching texts", () => {
    writeMem([
      memLine("mem-1", "preference", '"category": "c", "text": "same text"'),
      memLine("mem-2", "preference", '"category": "c", "text": "same text"'),
      learning("mem-3", "same text"),
    ]);
    const summary = compactMemory(tmpDir);
    expect(summary.duplicatesRemoved).toBe(0);
    const rendered = renderFile(memFile, 0);
    expect(rendered).toContain("[mem-1]");
    expect(rendered).toContain("[mem-2]");
    expect(rendered).toContain("[mem-3]");
  });

  it("appends tombstones instead of rewriting the file", () => {
    writeMem([
      learning("mem-1", "always run lint"),
      learning("mem-2", "always run lint"),
    ]);
    compactMemory(tmpDir);
    const content = readFileSync(memFile, "utf-8");
    // Original entries remain in the log; a tombstone is appended.
    expect(content).toContain('"id": "mem-1"');
    expect(content).toContain('"id": "mem-2"');
    expect(content).toContain('"type": "tombstone"');
    expect(content).toContain('"target_id": "mem-2"');
    expect(content).toContain("compact: duplicate learning");
  });

  it("returns zeros for a missing memory file", () => {
    const summary = compactMemory(tmpDir);
    expect(summary).toEqual({ scanned: 0, duplicatesRemoved: 0, ids: [] });
  });
});

describe("pruneMemory", () => {
  it("tombstones learnings strictly older than the cutoff", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T00:00:00Z"));
    writeMem([
      learning("mem-1", "ancient lesson", "2026-05-09T00:00:00Z"),
      learning("mem-2", "exactly at cutoff", "2026-05-10T00:00:00Z"),
      learning("mem-3", "recent lesson", "2026-06-01T00:00:00Z"),
    ]);
    const summary = pruneMemory(tmpDir, 30);
    expect(summary.scanned).toBe(3);
    expect(summary.pruned).toBe(1);
    expect(summary.ids).toEqual(["mem-1"]);
    const rendered = renderFile(memFile, 0);
    expect(rendered).not.toContain("[mem-1]");
    expect(rendered).toContain("[mem-2]");
    expect(rendered).toContain("[mem-3]");
    const content = readFileSync(memFile, "utf-8");
    expect(content).toContain("prune: older than 30 days");
  });

  it("never prunes preferences or meta", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T00:00:00Z"));
    writeMem([
      memLine(
        "mem-1",
        "preference",
        '"category": "c", "text": "old pref", "created": "2020-01-01T00:00:00Z"',
      ),
      memLine(
        "meta-1",
        "meta",
        '"key": "k", "value": "old meta", "created": "2020-01-01T00:00:00Z"',
      ),
      learning("mem-2", "old lesson", "2020-01-01T00:00:00Z"),
    ]);
    const summary = pruneMemory(tmpDir, 30);
    expect(summary.pruned).toBe(1);
    expect(summary.ids).toEqual(["mem-2"]);
    const rendered = renderFile(memFile, 0);
    expect(rendered).toContain("old pref");
    expect(rendered).toContain("old meta");
    expect(rendered).not.toContain("old lesson");
  });

  it("skips already-tombstoned learnings", () => {
    writeMem([
      learning("mem-1", "old lesson", "2020-01-01T00:00:00Z"),
      `{"id": "ts-1", "type": "tombstone", "target_id": "mem-1", "reason": "stale"}`,
    ]);
    const summary = pruneMemory(tmpDir, 30);
    expect(summary.scanned).toBe(0);
    expect(summary.pruned).toBe(0);
    const content = readFileSync(memFile, "utf-8");
    expect(content).not.toContain("prune:");
  });

  it("skips learnings with missing or unparseable created timestamps", () => {
    writeMem([
      learning("mem-1", "no timestamp"),
      learning("mem-2", "bad timestamp", "not-a-date"),
    ]);
    const summary = pruneMemory(tmpDir, 30);
    expect(summary.scanned).toBe(2);
    expect(summary.pruned).toBe(0);
  });
});
