import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTopic } from "@mobrienv/autoloop-core/journal";
import {
  type AcceptanceResult,
  reinjectAcceptanceFailure,
  runAcceptanceGate,
} from "@mobrienv/autoloop-harness/acceptance";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { describe, expect, it } from "vitest";

function makeLoop(verifyCmds: string[]): LoopContext {
  const workDir = mkdtempSync(join(tmpdir(), "autoloop-acceptance-"));
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  const journalFile = join(stateDir, "journal.jsonl");
  writeFileSync(journalFile, "", "utf-8");
  return {
    acceptance: { verifyCmds, timeoutMs: 30000 },
    paths: { workDir, stateDir, journalFile },
    runtime: { runId: "run-accept" },
  } as unknown as LoopContext;
}

function journalTopics(loop: LoopContext): string[] {
  return readFileSync(loop.paths.journalFile, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => extractTopic(l));
}

describe("runAcceptanceGate", () => {
  it("is a no-op (passes, ran=false) when no commands are configured", () => {
    const loop = makeLoop([]);
    const result = runAcceptanceGate(loop, 2);
    // No verify commands => gate passes without running and writes no journal.
    expect(result).toEqual({ ran: false, passed: true, failures: [] });
    expect(journalTopics(loop)).toHaveLength(0);
  });

  it("passes when every command exits 0", () => {
    const loop = makeLoop(["true", "exit 0"]);
    const result = runAcceptanceGate(loop, 2);
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
    const topics = journalTopics(loop);
    expect(topics).toContain("acceptance.start");
    expect(topics.filter((t) => t === "acceptance.command")).toHaveLength(2);
    expect(topics).toContain("acceptance.result");
  });

  it("fails and aggregates every non-zero command", () => {
    const loop = makeLoop(["true", "exit 3", "false"]);
    const result = runAcceptanceGate(loop, 2);
    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.exitCode)).toEqual([3, 1]);
    expect(result.failures.map((f) => f.command)).toEqual(["exit 3", "false"]);
  });

  it("captures command output in the failure tail", () => {
    const loop = makeLoop(["echo boom-detail >&2; exit 1"]);
    const result = runAcceptanceGate(loop, 2);
    expect(result.passed).toBe(false);
    expect(result.failures[0].tail).toContain("boom-detail");
  });

  it("runs in the work dir, not the harness cwd", () => {
    // A relative write lands in workDir only if the gate cd's there.
    const loop = makeLoop(["echo ok > marker.txt"]);
    runAcceptanceGate(loop, 1);
    expect(
      readFileSync(join(loop.paths.workDir, "marker.txt"), "utf-8").trim(),
    ).toBe("ok");
  });
});

describe("reinjectAcceptanceFailure", () => {
  it("appends operator.guidance carrying the failing command output", () => {
    const loop = makeLoop(["false"]);
    const result: AcceptanceResult = {
      ran: true,
      passed: false,
      failures: [
        {
          command: "npm test",
          exitCode: 1,
          timedOut: false,
          tail: "1 failing",
        },
      ],
    };
    reinjectAcceptanceFailure(loop, 2, result);
    const raw = readFileSync(loop.paths.journalFile, "utf-8");
    expect(journalTopics(loop)).toContain("operator.guidance");
    expect(raw).toContain("npm test");
    expect(raw).toContain("1 failing");
    expect(raw).toContain("blocked");
  });
});
