import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchInspect } from "../../src/commands/inspect.js";

/**
 * Real rendering of `inspect topology --run <id>`: the run's journal is read
 * from the project dir (flat or worktree layout) and its Jev lane is applied
 * to a preset target that lives elsewhere.
 */

const PRESET_TOML = `
name = "lanes"
completion = "task.complete"

[[role]]
id = "planner"
prompt = "Plan."
emits = ["plan.ready"]

[[role]]
id = "builder-opus"
prompt = "Build."
emits = ["task.complete"]
backend_kind = "claude-sdk"
backend_model = "claude-opus-5-5"

[[role]]
id = "builder-sol"
prompt = "Build."
emits = ["task.complete"]
backend_kind = "pi"
backend_model = "gpt-6-sol"

[handoff]
"loop.start" = ["planner"]
"plan.ready" = ["builder-sol"]
`;

let root: string;
let projectDir: string;
let presetDir: string;
const savedProjectDir = process.env.AUTOLOOP_PROJECT_DIR;

function jevRecord(run: string, handoff?: Record<string, string[]>): string {
  return JSON.stringify({
    run,
    topic: "routing.jev.selected",
    ts: "2026-09-26T00:00:00.000Z",
    v: 1,
    fields: {
      route: "feature",
      reason: "choice",
      ...(handoff ? { handoff: JSON.stringify(handoff) } : {}),
    },
  });
}

function writeJournal(dir: string, lines: string[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "journal.jsonl"), `${lines.join("\n")}\n`);
}

function inspectGraph(run: string): string[] {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  dispatchInspect(["topology", presetDir, "--format", "graph", "--run", run]);
  const output = spy.mock.calls.map((c) => c[0]).join("\n");
  spy.mockRestore();
  return output.split("\n");
}

beforeEach(() => {
  root = join(tmpdir(), `autoloop-topology-run-${process.pid}-${Date.now()}`);
  projectDir = join(root, "project");
  presetDir = join(root, "preset");
  mkdirSync(presetDir, { recursive: true });
  writeFileSync(join(presetDir, "topology.toml"), PRESET_TOML);
  process.env.AUTOLOOP_PROJECT_DIR = projectDir;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (savedProjectDir === undefined) delete process.env.AUTOLOOP_PROJECT_DIR;
  else process.env.AUTOLOOP_PROJECT_DIR = savedProjectDir;
});

describe("inspect topology --run", () => {
  it("applies the lane from a worktree run's journal", () => {
    writeJournal(
      join(projectDir, ".autoloop", "worktrees", "wt-1", "tree", ".autoloop"),
      [jevRecord("wt-1", { "plan.ready": ["builder-opus"] })],
    );
    const lines = inspectGraph("wt-1");
    expect(lines[0]).toBe("Jev lane: feature (choice)");
    expect(lines).toContain("[planner] --plan.ready--> [builder-opus]  (jev)");
    expect(lines).toContain("  builder-opus  claude-sdk · claude-opus-5-5");
    expect(lines).toContain("  planner       inherits base backend");
  });

  it("reads the project's top-level journal and ignores other runs", () => {
    writeJournal(join(projectDir, ".autoloop"), [
      jevRecord("other", { "plan.ready": ["builder-opus"] }),
      jevRecord("flat-1"),
    ]);
    const lines = inspectGraph("flat-1");
    expect(lines[0]).toBe("Jev lane: feature (choice)");
    expect(lines).toContain("[planner] --plan.ready--> [builder-sol]");
  });

  it("prints Jev lane: none for a run without a record", () => {
    const lines = inspectGraph("missing");
    expect(lines[0]).toBe("Jev lane: none");
    expect(lines).toContain("[planner] --plan.ready--> [builder-sol]");
  });
});
