import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractField, extractTopic } from "@mobrienv/autoloop-core/journal";
import {
  parseMetricValue,
  readProgressMetrics,
  runProgressMetric,
} from "@mobrienv/autoloop-harness/progress";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { describe, expect, it } from "vitest";

function makeLoop(metricCmd: string, name = "progress"): LoopContext {
  const workDir = mkdtempSync(join(tmpdir(), "autoloop-progress-"));
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  const journalFile = join(stateDir, "journal.jsonl");
  writeFileSync(journalFile, "", "utf-8");
  return {
    progress: { metricCmd, name, timeoutMs: 30000 },
    paths: { workDir, journalFile },
    runtime: { runId: "run-prog" },
  } as unknown as LoopContext;
}

describe("parseMetricValue", () => {
  it("takes the last numeric token", () => {
    expect(parseMetricValue("tests: 42 passed")).toBe(42);
    expect(parseMetricValue("coverage 0.87")).toBe(0.87);
    expect(parseMetricValue("5 of 10")).toBe(10);
  });
  it("returns null when there is no number", () => {
    expect(parseMetricValue("no digits here")).toBeNull();
    expect(parseMetricValue("")).toBeNull();
  });
});

describe("runProgressMetric", () => {
  it("runs the metric command and journals the scalar", () => {
    const loop = makeLoop("echo 'passing: 7'", "tests_passing");
    const m = runProgressMetric(loop, 3);
    expect(m).toEqual({ name: "tests_passing", value: 7, iteration: 3 });
    const raw = readFileSync(loop.paths.journalFile, "utf-8");
    expect(raw).toContain("progress.metric");
    const line = raw
      .split("\n")
      .find((l) => extractTopic(l) === "progress.metric");
    expect(line && extractField(line, "name")).toBe("tests_passing");
    expect(line && extractField(line, "value")).toBe("7");
  });

  it("is a no-op when no metric command is configured", () => {
    const loop = makeLoop("");
    expect(runProgressMetric(loop, 1)).toBeNull();
    expect(readFileSync(loop.paths.journalFile, "utf-8")).toBe("");
  });

  it("is a no-op when the command output has no number", () => {
    const loop = makeLoop("echo no-number-here");
    expect(runProgressMetric(loop, 1)).toBeNull();
    expect(readFileSync(loop.paths.journalFile, "utf-8")).toBe("");
  });

  it("runs in the work dir", () => {
    const loop = makeLoop("ls -1 | wc -l");
    writeFileSync(join(loop.paths.workDir, "a.txt"), "");
    writeFileSync(join(loop.paths.workDir, "b.txt"), "");
    const m = runProgressMetric(loop, 1);
    // workDir has a.txt, b.txt, and the .autoloop dir → 3 entries.
    expect(m?.value).toBeGreaterThanOrEqual(2);
  });
});

describe("readProgressMetrics", () => {
  it("reads the journaled series across iterations (queryable)", () => {
    const loop = makeLoop("echo 1", "score");
    // Simulate three iterations with rising scores.
    for (const [iter, cmd] of [
      [1, "echo 3"],
      [2, "echo 5"],
      [3, "echo 9"],
    ] as Array<[number, string]>) {
      loop.progress = { metricCmd: cmd, name: "score", timeoutMs: 30000 };
      runProgressMetric(loop, iter);
    }
    const lines = readFileSync(loop.paths.journalFile, "utf-8")
      .split("\n")
      .filter(Boolean);
    const series = readProgressMetrics(lines);
    expect(series.map((m) => m.value)).toEqual([3, 5, 9]);
    expect(series.map((m) => m.iteration)).toEqual([1, 2, 3]);
    expect(series.every((m) => m.name === "score")).toBe(true);
  });

  it("returns [] when no metric was recorded", () => {
    expect(readProgressMetrics([])).toEqual([]);
  });
});
