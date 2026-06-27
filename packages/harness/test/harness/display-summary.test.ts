import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent } from "@mobrienv/autoloop-core/journal";
import { afterEach, describe, expect, it, vi } from "vitest";
import { printSummary } from "../../src/display.js";
import type { LoopContext, RunSummary } from "../../src/types.js";

// printSummary surfaces cumulative run cost so subprocess drivers (ralph v3)
// can parse it from the summary block — see autoloop#34.

function usageFields(cost: number): string {
  return (
    `"input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0, ` +
    `"cache_write_tokens": 0, "total_tokens": 0, "cost_usd": ${cost}`
  );
}

function fakeLoop(dir: string, runId: string): LoopContext {
  return {
    runtime: { runId },
    paths: {
      journalFile: join(dir, "journal.jsonl"),
      memoryFile: join(dir, "memory.jsonl"),
      toolPath: "autoloop",
    },
    review: { every: 0 },
  } as unknown as LoopContext;
}

function captureSummary(summary: RunSummary, loop: LoopContext): string[] {
  const logged: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
    logged.push(String(line));
  });
  printSummary(summary, loop);
  return logged;
}

describe("printSummary cost_usd", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits cumulative cost_usd summed from backend.usage events", () => {
    const dir = mkdtempSync(join(tmpdir(), "al-summary-"));
    const runId = "run-cost-1";
    const journalFile = join(dir, "journal.jsonl");
    appendEvent(journalFile, runId, "1", "backend.usage", usageFields(0.05));
    appendEvent(journalFile, runId, "2", "backend.usage", usageFields(0.03));

    const logged = captureSummary(
      { iterations: 2, stopReason: "completed" },
      fakeLoop(dir, runId),
    );

    expect(logged).toContain("cost_usd: 0.080000");
  });

  it("emits cost_usd: 0.000000 when no usage was recorded", () => {
    const dir = mkdtempSync(join(tmpdir(), "al-summary-empty-"));
    const logged = captureSummary(
      { iterations: 0, stopReason: "max_iterations" },
      fakeLoop(dir, "run-empty"),
    );

    expect(logged).toContain("cost_usd: 0.000000");
  });
});
