import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIterationDiffInspect } from "../../src/cli/render.js";

function journalLine(run: string, topic: string, iteration: number): string {
  return JSON.stringify({
    run,
    topic,
    iteration: String(iteration),
    ts: new Date().toISOString(),
    fields: { prompt: `iter ${iteration} prompt` },
  });
}

function setupRun(): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-inspect-diff-"));
  const stateDir = join(dir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, "journal.jsonl"),
    [
      journalLine("r1", "iteration.start", 1),
      journalLine("r1", "iteration.start", 2),
    ].join("\n") + "\n",
  );
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  delete process.env.AUTOLOOP_PROJECT_DIR;
});

function capture(fn: () => void): string {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a) =>
    lines.push(a.join(" ")),
  );
  vi.spyOn(process.stderr, "write").mockImplementation((s) => {
    lines.push(String(s));
    return true;
  });
  fn();
  return lines.join("\n");
}

describe("renderIterationDiffInspect", () => {
  it("exits non-zero on missing arguments", () => {
    const out = capture(() => renderIterationDiffInspect([]));
    expect(out).toContain("requires a run-id and two iterations");
    expect(process.exitCode).toBe(1);
  });

  it("errors (non-zero) for a run that does not exist instead of a false identical diff", () => {
    const dir = setupRun();
    process.env.AUTOLOOP_PROJECT_DIR = dir;
    const out = capture(() => renderIterationDiffInspect(["ghost", "1", "2"]));
    expect(out).toContain("not found");
    expect(out).not.toContain("identical");
    expect(process.exitCode).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it("renders a diff for a real run", () => {
    const dir = setupRun();
    process.env.AUTOLOOP_PROJECT_DIR = dir;
    const out = capture(() => renderIterationDiffInspect(["r1", "1", "2"]));
    expect(out).toContain("Diff r1");
    expect(process.exitCode ?? 0).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
