// Exercises the REAL per-branch executor (`buildStageBranchRunner`) — its
// prompt rendering, wave-spec construction, output → `BranchResult` mapping, and
// journaling. Only the spawn/poll boundary (`launch-branches.js`) is mocked, so
// the JSON-object mapping that turns a branch's final response into structured
// `data` (or a dead branch) is genuinely executed here rather than stubbed away
// (the gap the reduce/route wrapper tests in `stage.test.ts` left open).

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRunLines } from "@mobrienv/autoloop-core/journal";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchSpec as WaveBranchSpec } from "../../src/wave/types.js";

// The spawn boundary: capture what the runner would launch, and return a
// scripted branch outcome instead of spinning up a real `branch-run` subprocess.
const launchedSpecs: WaveBranchSpec[] = [];
let scriptedResult: {
  stopReason: string;
  output: string;
  elapsedMs: number;
};

vi.mock("../../src/wave/launch-branches.js", () => ({
  writeBranchLaunch: (spec: WaveBranchSpec) => {
    launchedSpecs.push(spec);
  },
  launchParallelBranches: (_loop: unknown, specs: WaveBranchSpec[]) => specs,
  joinParallelBranches: (
    _loop: unknown,
    _iter: unknown,
    _waveId: string,
    pending: WaveBranchSpec[],
  ) =>
    pending.map((spec) => ({
      branchId: spec.branchId,
      objective: spec.objective,
      stopReason: scriptedResult.stopReason,
      output: scriptedResult.output,
      routingEvent: spec.routingEvent,
      allowedRoles: spec.allowedRoles,
      allowedEvents: spec.allowedEvents,
      branchDir: spec.branchDir,
      elapsedMs: scriptedResult.elapsedMs,
      finishedAtMs: Date.now(),
    })),
}));

import type { BranchSpec as StageSpec } from "../../src/fanout-runner.js";
import type { IterationContext } from "../../src/prompt.js";
import { buildStageBranchRunner } from "../../src/wave/stage-branch-runner.js";

function makeLoop(): LoopContext {
  const workDir = mkdtempSync(join(tmpdir(), "autoloop-sbr-"));
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  const journalFile = join(stateDir, "journal.jsonl");
  writeFileSync(journalFile, "", "utf-8");
  return {
    objective: "verify the widget behaves",
    topology: {
      name: "p",
      completion: "task.complete",
      roles: [
        {
          id: "verifier",
          prompt: "You are a strict verifier. Decide affirm true/false.",
          promptFile: "",
          emits: ["verify.passed", "verify.blocked"],
        },
      ],
      handoff: {},
      handoffKeys: [],
      gates: [],
      stages: [],
    },
    paths: { stateDir, journalFile },
    runtime: { runId: "run-sbr" },
  } as unknown as LoopContext;
}

function iterCtx(iteration = 1): IterationContext {
  return { iteration } as unknown as IterationContext;
}

function branchSpec(overrides: Partial<StageSpec> = {}): StageSpec {
  return {
    branchId: "verify.0",
    stageId: "verify",
    role: "verifier",
    objective: "verifier",
    index: 0,
    ...overrides,
  };
}

beforeEach(() => {
  launchedSpecs.length = 0;
});

describe("buildStageBranchRunner — real branch mapping", () => {
  it("maps a completed branch whose output is a JSON object to a live BranchResult", async () => {
    const loop = makeLoop();
    scriptedResult = {
      stopReason: "completion_event",
      output: '{"affirm": true, "reason": "all tests pass"}',
      elapsedMs: 1200,
    };
    const run = buildStageBranchRunner(loop, iterCtx(), "verify");

    const result = await run(branchSpec());

    expect(result).toEqual({
      branchId: "verify.0",
      ok: true,
      data: { affirm: true, reason: "all tests pass" },
    });
  });

  it("treats a completed branch that emits prose (not a JSON object) as a dead branch", async () => {
    const loop = makeLoop();
    scriptedResult = {
      stopReason: "completion_event",
      output: "Looks good to me, everything passes.",
      elapsedMs: 900,
    };
    const run = buildStageBranchRunner(loop, iterCtx(), "verify");

    const result = await run(branchSpec());

    expect(result.ok).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.error).toMatch(/parseable JSON object/);
  });

  it("treats a JSON array (not an object) as a dead branch", async () => {
    const loop = makeLoop();
    scriptedResult = {
      stopReason: "completion_event",
      output: '[{"affirm": true}]',
      elapsedMs: 900,
    };
    const run = buildStageBranchRunner(loop, iterCtx(), "verify");

    const result = await run(branchSpec());

    expect(result.ok).toBe(false);
  });

  it("treats a branch that did not reach a terminal success reason as a dead branch even with valid JSON", async () => {
    const loop = makeLoop();
    scriptedResult = {
      stopReason: "timeout",
      output: '{"affirm": true}',
      elapsedMs: 60000,
    };
    const run = buildStageBranchRunner(loop, iterCtx(), "verify");

    const result = await run(branchSpec());

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timeout/);
  });

  it("accepts max_iterations and completion_promise as terminal success reasons", async () => {
    const loop = makeLoop();
    for (const stopReason of ["max_iterations", "completion_promise"]) {
      scriptedResult = {
        stopReason,
        output: '{"affirm": false, "reason": "regression"}',
        elapsedMs: 500,
      };
      const run = buildStageBranchRunner(loop, iterCtx(), "verify");
      const result = await run(branchSpec());
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ affirm: false, reason: "regression" });
    }
  });

  it("renders the branch prompt from the role prompt plus the single-JSON-object instruction", async () => {
    const loop = makeLoop();
    scriptedResult = {
      stopReason: "completion_event",
      output: '{"affirm": true}',
      elapsedMs: 100,
    };
    const run = buildStageBranchRunner(loop, iterCtx(), "verify");
    await run(branchSpec());

    expect(launchedSpecs).toHaveLength(1);
    const prompt = launchedSpecs[0].prompt;
    expect(prompt).toContain("You are a strict verifier");
    expect(prompt).toContain("EXACTLY ONE JSON object");
    expect(prompt).toContain(loop.objective);
    // The wave spec restricts the branch to its own role and events.
    expect(launchedSpecs[0].allowedRoles).toEqual(["verifier"]);
    expect(launchedSpecs[0].allowedEvents).toEqual([
      "verify.passed",
      "verify.blocked",
    ]);
  });

  it("journals stage.branch.start and stage.branch.finish with the mapped result", async () => {
    const loop = makeLoop();
    scriptedResult = {
      stopReason: "completion_event",
      output: '{"affirm": true, "reason": "ok"}',
      elapsedMs: 1500,
    };
    const run = buildStageBranchRunner(loop, iterCtx(3), "verify");
    await run(branchSpec());

    const lines = readRunLines(loop.paths.journalFile, "run-sbr");
    const start = lines.find(
      (l) =>
        (JSON.parse(l) as { topic?: string }).topic === "stage.branch.start",
    );
    const finish = lines.find(
      (l) =>
        (JSON.parse(l) as { topic?: string }).topic === "stage.branch.finish",
    );
    expect(start).toBeDefined();
    expect(finish).toBeDefined();
    expect(start).toContain("verify.0");
    expect(finish).toContain('"ok"');
    expect(finish).toContain("true");
    expect(finish).toContain("elapsed_ms");
  });
});
