import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readAllJournals, readRunJournal } from "../../src/harness/journal.js";

const tmpDir = join(import.meta.dirname, "__tmp_journal_test__");

function journalLine(run: string, topic: string, ts: string): string {
  return JSON.stringify({ run, topic, timestamp: ts });
}

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("readAllJournals", () => {
  it("reads top-level journal when no runs/ dir exists", () => {
    const journalFile = join(tmpDir, "journal.jsonl");
    writeFileSync(journalFile, journalLine("r1", "loop.start", "2026-01-01T00:00:00Z") + "\n");

    const lines = readAllJournals(tmpDir);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("r1");
  });

  it("merges top-level and per-run journals sorted by timestamp", () => {
    const journalFile = join(tmpDir, "journal.jsonl");
    writeFileSync(journalFile, journalLine("r1", "loop.start", "2026-01-01T00:00:00Z") + "\n");

    const runDir = join(tmpDir, "runs", "r2");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "journal.jsonl"),
      journalLine("r2", "loop.start", "2026-01-01T00:00:01Z") + "\n" +
      journalLine("r2", "iteration.start", "2026-01-01T00:00:02Z") + "\n",
    );

    const lines = readAllJournals(tmpDir);
    expect(lines).toHaveLength(3);
    // Verify sorted order
    expect(lines[0]).toContain("r1");
    expect(lines[1]).toContain('"loop.start"');
    expect(lines[2]).toContain("iteration.start");
  });

  it("returns empty array when nothing exists", () => {
    const lines = readAllJournals(tmpDir);
    expect(lines).toHaveLength(0);
  });
});

describe("readRunJournal", () => {
  it("reads journal for a specific run", () => {
    const runDir = join(tmpDir, "runs", "r1");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "journal.jsonl"),
      journalLine("r1", "loop.start", "2026-01-01T00:00:00Z") + "\n",
    );

    const lines = readRunJournal(tmpDir, "r1");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("r1");
  });

  it("returns empty array for non-existent run", () => {
    const lines = readRunJournal(tmpDir, "nonexistent");
    expect(lines).toHaveLength(0);
  });
});
