import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTopic } from "@mobrienv/autoloop-core/journal";
import {
  countRearms,
  detectPrematureQuit,
  rearmPrematureQuit,
} from "@mobrienv/autoloop-harness/premature-quit";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { describe, expect, it } from "vitest";

function taskLine(id: string, status: "open" | "done", soft = false): string {
  // Match the on-disk serialization (spaced `"key": value`, as jsonField emits)
  // so the lightweight field extractor parses it.
  const fields = [
    `"type": "task"`,
    `"id": "${id}"`,
    `"text": "${id}"`,
    `"status": "${status}"`,
  ];
  if (soft) fields.push(`"soft": "true"`);
  return `{${fields.join(", ")}}`;
}

function makeLoop(opts: { tasks?: string[]; requiredEvents?: string[] }): {
  loop: LoopContext;
  journalFile: string;
} {
  const workDir = mkdtempSync(join(tmpdir(), "autoloop-premature-"));
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  const journalFile = join(stateDir, "journal.jsonl");
  const tasksFile = join(stateDir, "tasks.jsonl");
  writeFileSync(journalFile, "", "utf-8");
  writeFileSync(tasksFile, (opts.tasks ?? []).join("\n"), "utf-8");
  const loop = {
    completion: { requiredEvents: opts.requiredEvents ?? [] },
    paths: { workDir, journalFile, tasksFile },
    runtime: { runId: "run-pq" },
  } as unknown as LoopContext;
  return { loop, journalFile };
}

function ev(topic: string): string {
  return JSON.stringify({ run: "run-pq", topic });
}

describe("detectPrematureQuit", () => {
  it("flags a stop with an open non-soft task and no blocker", () => {
    const { loop } = makeLoop({ tasks: [taskLine("t1", "open")] });
    const check = detectPrematureQuit(loop, [ev("iteration.finish")]);
    expect(check.premature).toBe(true);
    expect(check.reasons.join(" ")).toContain("t1");
  });

  it("flags an unmet required completion event", () => {
    const { loop } = makeLoop({ requiredEvents: ["verify.done"] });
    const check = detectPrematureQuit(loop, [ev("iteration.finish")]);
    expect(check.premature).toBe(true);
    expect(check.reasons.join(" ")).toContain("verify.done");
  });

  it("is not premature when no work remains", () => {
    const { loop } = makeLoop({ tasks: [taskLine("t1", "done")] });
    expect(detectPrematureQuit(loop, [ev("iteration.finish")]).premature).toBe(
      false,
    );
  });

  it("ignores soft tasks (advisory, not authorized work)", () => {
    const { loop } = makeLoop({ tasks: [taskLine("t1", "open", true)] });
    expect(detectPrematureQuit(loop, [ev("iteration.finish")]).premature).toBe(
      false,
    );
  });

  it("is not premature when the latest turn hit a transient blocker", () => {
    const { loop } = makeLoop({ tasks: [taskLine("t1", "open")] });
    // A transient pause is the most recent signal → availability blocker.
    const lines = [ev("iteration.finish"), ev("backend.transient")];
    expect(detectPrematureQuit(loop, lines).premature).toBe(false);
  });
});

describe("countRearms", () => {
  it("counts premature.rearm markers", () => {
    expect(
      countRearms([
        ev("premature.rearm"),
        ev("iteration.finish"),
        ev("premature.rearm"),
      ]),
    ).toBe(2);
  });
});

describe("rearmPrematureQuit", () => {
  it("journals a re-arm and an operator guidance nudge", () => {
    const { loop, journalFile } = makeLoop({ tasks: [taskLine("t1", "open")] });
    rearmPrematureQuit(loop, 2, {
      premature: true,
      reasons: ["1 open task(s): t1"],
    });
    const topics = readFileSync(journalFile, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => extractTopic(l));
    expect(topics).toContain("premature.rearm");
    expect(topics).toContain("operator.guidance");
  });
});
