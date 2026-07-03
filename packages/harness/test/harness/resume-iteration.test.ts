import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeEvent } from "@mobrienv/autoloop-core";
import { determineResumeIteration } from "@mobrienv/autoloop-harness";
import { describe, expect, it } from "vitest";

/**
 * determineResumeIteration — the four stop-reason branches from the RFC.
 * Uses a real on-disk journal because the function reads run lines from it
 * for the interrupted/stopped case.
 */

const RUN = "run-x";

function writeJournal(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-resume-iter-"));
  const file = join(dir, "journal.jsonl");
  writeFileSync(file, `${lines.join("\n")}\n`, "utf-8");
  return file;
}

function finish(iteration: string): string {
  return encodeEvent({
    shape: "fields",
    run: RUN,
    iteration,
    topic: "iteration.finish",
    fields: { exit_code: "0", output: "ok" },
  });
}

function start(iteration: string): string {
  return encodeEvent({
    shape: "fields",
    run: RUN,
    iteration,
    topic: "iteration.start",
    fields: {},
  });
}

describe("determineResumeIteration", () => {
  it("max_iterations resumes at the blocked iteration (registry + 1)", () => {
    // Completed 7 of 10; registry iteration = 7. Blocked iteration is 8.
    const journal = writeJournal([finish("6"), finish("7")]);
    expect(determineResumeIteration(journal, RUN, "max_iterations", 7)).toBe(8);
  });

  it("backend_failed retries the failed iteration (registry)", () => {
    // Iteration 4 started, no finish — it failed. Retry 4.
    const journal = writeJournal([finish("3"), start("4")]);
    expect(determineResumeIteration(journal, RUN, "backend_failed", 4)).toBe(4);
  });

  it("backend_timeout retries the timed-out iteration (registry)", () => {
    const journal = writeJournal([finish("2"), start("3")]);
    expect(determineResumeIteration(journal, RUN, "backend_timeout", 3)).toBe(
      3,
    );
  });

  it("interrupted with an iteration.finish for N resumes at N + 1", () => {
    // Iteration 5 finished before the interrupt landed → resume at 6.
    const journal = writeJournal([finish("4"), start("5"), finish("5")]);
    expect(determineResumeIteration(journal, RUN, "interrupted", 5)).toBe(6);
  });

  it("interrupted without an iteration.finish for N retries N", () => {
    // Iteration 5 was in-flight when interrupted (start, no finish) → retry 5.
    const journal = writeJournal([finish("4"), start("5")]);
    expect(determineResumeIteration(journal, RUN, "interrupted", 5)).toBe(5);
  });

  it("stopped falls through the journal-scan branch like interrupted", () => {
    const journalFinished = writeJournal([start("3"), finish("3")]);
    expect(determineResumeIteration(journalFinished, RUN, "stopped", 3)).toBe(
      4,
    );
    const journalInFlight = writeJournal([start("3")]);
    expect(determineResumeIteration(journalInFlight, RUN, "stopped", 3)).toBe(
      3,
    );
  });
});
