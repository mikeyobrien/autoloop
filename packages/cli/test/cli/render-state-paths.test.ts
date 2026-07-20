import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderAllJournals,
  renderJournal,
  renderJournalTimeline,
} from "../../src/cli/render.js";

let projectDir: string;
let output: string[];

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "cli-render-nested-state-"));
  output = [];
  vi.spyOn(console, "log").mockImplementation((...args) => {
    output.push(args.join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(projectDir, { recursive: true, force: true });
});

function writeNestedWorktreeJournal(): { line: string; runId: string } {
  const stateDirRelativePath = join(".ralph", "autoloop");
  const stateDir = join(projectDir, stateDirRelativePath);
  const runId = "nested-worktree-run";
  const journalPath = join(
    stateDir,
    "worktrees",
    runId,
    "tree",
    stateDirRelativePath,
    "journal.jsonl",
  );
  const line = JSON.stringify({
    run: runId,
    topic: "loop.start",
    iteration: "1",
    timestamp: "2026-01-01T00:00:00.000Z",
    fields: { preset: "autocode" },
  });

  mkdirSync(join(projectDir, stateDirRelativePath), { recursive: true });
  writeFileSync(
    join(projectDir, "autoloops.toml"),
    'core.state_dir = ".ralph/autoloop"\n',
  );
  mkdirSync(dirname(journalPath), { recursive: true });
  writeFileSync(journalPath, `${line}\n`);
  return { line, runId };
}

describe("journal rendering with a nested state root", () => {
  it("renders a selected worktree run from the configured nested path", () => {
    const { line, runId } = writeNestedWorktreeJournal();

    renderJournal(projectDir, runId);

    expect(output).toEqual([line]);
  });

  it("includes nested worktree journals in all-journal output", () => {
    const { line } = writeNestedWorktreeJournal();

    renderAllJournals(projectDir);

    expect(output).toEqual([line]);
  });

  it("includes nested worktree journals in the all-runs timeline", () => {
    writeNestedWorktreeJournal();

    renderJournalTimeline(projectDir, { allRuns: true });

    expect(output.join("\n")).toContain("loop.start");
    expect(output.join("\n")).toContain("preset=autocode");
  });
});
