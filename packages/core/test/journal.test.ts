import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAllJournals, readRunJournal } from "../src/journal.js";

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
    writeFileSync(
      journalFile,
      `${journalLine("r1", "loop.start", "2026-01-01T00:00:00Z")}\n`,
    );

    const lines = readAllJournals(tmpDir);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("r1");
  });

  it("merges top-level and per-run journals sorted by timestamp", () => {
    const journalFile = join(tmpDir, "journal.jsonl");
    writeFileSync(
      journalFile,
      `${journalLine("r1", "loop.start", "2026-01-01T00:00:00Z")}\n`,
    );

    const runDir = join(tmpDir, "runs", "r2");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "journal.jsonl"),
      journalLine("r2", "loop.start", "2026-01-01T00:00:01Z") +
        "\n" +
        journalLine("r2", "iteration.start", "2026-01-01T00:00:02Z") +
        "\n",
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
      `${journalLine("r1", "loop.start", "2026-01-01T00:00:00Z")}\n`,
    );

    const lines = readRunJournal(tmpDir, "r1");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("r1");
  });

  it("reads journal from worktree path", () => {
    // stateDir basename is used to find the journal inside the worktree
    const stateDirName = tmpDir.split("/").pop()!;
    const wtDir = join(tmpDir, "worktrees", "wt-run-1", "tree", stateDirName);
    mkdirSync(wtDir, { recursive: true });
    writeFileSync(
      join(wtDir, "journal.jsonl"),
      journalLine("wt-run-1", "loop.start", "2026-01-01T00:00:00Z") +
        "\n" +
        journalLine("wt-run-1", "iteration.start", "2026-01-01T00:00:01Z") +
        "\n",
    );

    const lines = readRunJournal(tmpDir, "wt-run-1");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("wt-run-1");
  });

  it("prefers run-scoped journal over worktree journal", () => {
    // Set up both run-scoped and worktree journals
    const runDir = join(tmpDir, "runs", "dual-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "journal.jsonl"),
      `${journalLine("dual-run", "loop.start", "2026-01-01T00:00:00Z")}\n`,
    );

    const stateDirName = tmpDir.split("/").pop()!;
    const wtDir = join(tmpDir, "worktrees", "dual-run", "tree", stateDirName);
    mkdirSync(wtDir, { recursive: true });
    writeFileSync(
      join(wtDir, "journal.jsonl"),
      journalLine("dual-run", "loop.start", "2026-01-01T00:00:00Z") +
        "\n" +
        journalLine("dual-run", "extra", "2026-01-01T00:00:01Z") +
        "\n",
    );

    // Should get 1 line (run-scoped), not 2 (worktree)
    const lines = readRunJournal(tmpDir, "dual-run");
    expect(lines).toHaveLength(1);
  });

  it("returns empty array for non-existent run", () => {
    const lines = readRunJournal(tmpDir, "nonexistent");
    expect(lines).toHaveLength(0);
  });
});

describe("readAllJournals with worktree journals", () => {
  it("merges worktree journals with top-level", () => {
    // Top-level journal
    writeFileSync(
      join(tmpDir, "journal.jsonl"),
      `${journalLine("r1", "loop.start", "2026-01-01T00:00:00Z")}\n`,
    );

    // Worktree journal
    const stateDirName = tmpDir.split("/").pop()!;
    const wtDir = join(tmpDir, "worktrees", "wt-1", "tree", stateDirName);
    mkdirSync(wtDir, { recursive: true });
    writeFileSync(
      join(wtDir, "journal.jsonl"),
      `${journalLine("wt-1", "loop.start", "2026-01-01T00:00:02Z")}\n`,
    );

    const lines = readAllJournals(tmpDir);
    expect(lines).toHaveLength(2);
    // Sorted by timestamp: r1 first, wt-1 second
    expect(lines[0]).toContain("r1");
    expect(lines[1]).toContain("wt-1");
  });
});
