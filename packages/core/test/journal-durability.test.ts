import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendText,
  atomicWriteFile,
  isValidJournalLine,
  quarantineJournal,
  readLines,
} from "../src/journal.js";

const tmpDir = join(import.meta.dirname, "__tmp_journal_durability__");

function rec(run: string, topic: string): string {
  return JSON.stringify({ run, topic });
}

beforeEach(() => mkdirSync(tmpDir, { recursive: true }));
afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

describe("isValidJournalLine", () => {
  it("accepts a well-formed record", () => {
    expect(isValidJournalLine(rec("r1", "loop.start"))).toBe(true);
  });
  it("rejects a torn/partial JSON line", () => {
    expect(isValidJournalLine('{"run":"r1","topic":')).toBe(false);
  });
  it("rejects empty and non-JSON lines", () => {
    expect(isValidJournalLine("")).toBe(false);
    expect(isValidJournalLine("not json at all")).toBe(false);
  });
});

describe("appendText (durable) round-trips", () => {
  it("appends newline-terminated records that readLines reads back", () => {
    const p = join(tmpDir, "journal.jsonl");
    appendText(p, `${rec("r1", "a")}\n`);
    appendText(p, `${rec("r1", "b")}\n`);
    expect(readLines(p)).toEqual([rec("r1", "a"), rec("r1", "b")]);
  });

  it("creates the parent directory if missing", () => {
    const p = join(tmpDir, "nested", "deep", "journal.jsonl");
    appendText(p, `${rec("r1", "a")}\n`);
    expect(readLines(p)).toEqual([rec("r1", "a")]);
  });
});

describe("readLines validate-on-read (non-fatal)", () => {
  it("skips a torn final line left by a crash mid-write", () => {
    const p = join(tmpDir, "journal.jsonl");
    // Two good records, then a torn partial record (no trailing newline).
    writeFileSync(p, `${rec("r1", "a")}\n${rec("r1", "b")}\n{"run":"r1","top`);
    // The torn line is skipped, the run is not wedged.
    expect(readLines(p)).toEqual([rec("r1", "a"), rec("r1", "b")]);
  });
});

describe("atomicWriteFile", () => {
  it("writes content and leaves no temp file behind", () => {
    const p = join(tmpDir, "out.txt");
    atomicWriteFile(p, "hello\n");
    expect(readFileSync(p, "utf-8")).toBe("hello\n");
    expect(existsSync(`${p}.tmp`)).toBe(false);
  });

  it("atomically replaces existing content", () => {
    const p = join(tmpDir, "out.txt");
    writeFileSync(p, "old");
    atomicWriteFile(p, "new");
    expect(readFileSync(p, "utf-8")).toBe("new");
  });
});

describe("quarantineJournal", () => {
  it("moves corrupt lines aside and rewrites the journal with valid ones", () => {
    const p = join(tmpDir, "journal.jsonl");
    writeFileSync(
      p,
      `${rec("r1", "a")}\n{"torn":\n${rec("r1", "b")}\ngarbage line\n`,
    );
    const { quarantined } = quarantineJournal(p);
    expect(quarantined).toBe(2);
    expect(readLines(p)).toEqual([rec("r1", "a"), rec("r1", "b")]);
    const q = readFileSync(`${p}.quarantine`, "utf-8");
    expect(q).toContain('{"torn":');
    expect(q).toContain("garbage line");
  });

  it("is a no-op on a clean journal (no rewrite, no quarantine file)", () => {
    const p = join(tmpDir, "journal.jsonl");
    writeFileSync(p, `${rec("r1", "a")}\n${rec("r1", "b")}\n`);
    expect(quarantineJournal(p)).toEqual({ quarantined: 0 });
    expect(existsSync(`${p}.quarantine`)).toBe(false);
  });

  it("returns 0 for a missing journal", () => {
    expect(quarantineJournal(join(tmpDir, "nope.jsonl"))).toEqual({
      quarantined: 0,
    });
  });

  it("recovers a kill -9 journal: valid kept, torn quarantined", () => {
    const p = join(tmpDir, "journal.jsonl");
    // good records + a torn final write (the classic crash signature)
    writeFileSync(p, `${rec("r1", "a")}\n${rec("r1", "b")}\n{"run":"r1","to`);
    const { quarantined } = quarantineJournal(p);
    expect(quarantined).toBe(1);
    expect(readLines(p)).toEqual([rec("r1", "a"), rec("r1", "b")]);
    // After repair, the journal is clean and a re-run is a no-op.
    expect(quarantineJournal(p)).toEqual({ quarantined: 0 });
  });
});
