import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeEvent } from "@mobrienv/autoloop-core";
import { findDanglingProvisional } from "@mobrienv/autoloop-harness/provisional";
import { describe, expect, it } from "vitest";

const RUN = "run-x";

function writeJournal(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-provisional-"));
  const file = join(dir, "journal.jsonl");
  writeFileSync(file, `${lines.join("\n")}\n`, "utf-8");
  return file;
}

function completion(
  topic: "completion.provisional" | "completion.accepted" | "completion.held",
  iteration: number,
  run = RUN,
  reason?: string,
): string {
  return encodeEvent({
    shape: "fields",
    run,
    iteration: String(iteration),
    topic,
    fields: reason === undefined ? {} : { reason },
  });
}

describe("findDanglingProvisional", () => {
  it("returns a provisional completion without a resolution", () => {
    const journal = writeJournal([
      completion("completion.provisional", 3, RUN, "completion_promise"),
    ]);

    expect(findDanglingProvisional(journal, RUN)).toEqual({
      iteration: 3,
      reason: "completion_promise",
    });
  });

  it("ignores a provisional completion resolved as accepted", () => {
    const journal = writeJournal([
      completion("completion.provisional", 3),
      completion("completion.accepted", 3),
    ]);

    expect(findDanglingProvisional(journal, RUN)).toBeNull();
  });

  it("ignores a provisional completion resolved as held", () => {
    const journal = writeJournal([
      completion("completion.provisional", 3),
      completion("completion.held", 3),
    ]);

    expect(findDanglingProvisional(journal, RUN)).toBeNull();
  });

  it("returns the latest dangling claim after an earlier resolution", () => {
    const journal = writeJournal([
      completion("completion.provisional", 2),
      completion("completion.accepted", 2),
      completion("completion.provisional", 3, RUN, "completion_promise"),
    ]);

    expect(findDanglingProvisional(journal, RUN)).toEqual({
      iteration: 3,
      reason: "completion_promise",
    });
  });

  it("ignores completion records from another run", () => {
    const journal = writeJournal([
      completion("completion.provisional", 9, "run-y"),
      completion("completion.provisional", 2),
      completion("completion.accepted", 2),
    ]);

    expect(findDanglingProvisional(journal, RUN)).toBeNull();
  });

  it("returns null for empty and missing journals", () => {
    const missing = join(
      mkdtempSync(join(tmpdir(), "autoloop-provisional-missing-")),
      "journal.jsonl",
    );

    expect(findDanglingProvisional(writeJournal([]), RUN)).toBeNull();
    expect(findDanglingProvisional(missing, RUN)).toBeNull();
  });

  it("returns a later re-claim after an earlier claim was held", () => {
    const journal = writeJournal([
      completion("completion.provisional", 2),
      completion("completion.held", 2),
      completion("completion.provisional", 4, RUN, "completion_promise"),
    ]);

    expect(findDanglingProvisional(journal, RUN)).toEqual({
      iteration: 4,
      reason: "completion_promise",
    });
  });

  it("uses completion_event when the claim has no reason", () => {
    const journal = writeJournal([completion("completion.provisional", 3)]);

    expect(findDanglingProvisional(journal, RUN)).toEqual({
      iteration: 3,
      reason: "completion_event",
    });
  });
});
