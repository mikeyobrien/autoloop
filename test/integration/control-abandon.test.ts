import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ensureBuild,
  FIXTURES_DIR,
  makeTempProject,
  runCli,
} from "../helpers/runtime.js";

beforeAll(() => {
  ensureBuild();
});

const ZERO_FIXTURE = join(FIXTURES_DIR, "wait-request-zero.json");
const COMPLETE_FIXTURE = join(FIXTURES_DIR, "complete-success.json");

function soleRunId(project: string): string {
  const res = runCli(
    ["loops", "--all"],
    { AUTOLOOP_PROJECT_DIR: project },
    project,
  );
  const lines = res.stdout.trim().split("\n");
  expect(lines.length).toBeGreaterThanOrEqual(2);
  return lines[1].trim().split(/\s{2,}/)[0];
}

function lastRegistryRecord(
  project: string,
  runId: string,
): { status: string; stop_reason: string; pid?: number } {
  const path = join(project, ".autoloop", "registry.jsonl");
  const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
  let latest: { status: string; stop_reason: string; pid?: number } | null =
    null;
  for (const line of lines) {
    const rec = JSON.parse(line) as {
      run_id?: string;
      status: string;
      stop_reason: string;
      pid?: number;
    };
    if (rec.run_id === runId) latest = rec;
  }
  if (!latest) throw new Error(`no registry record for ${runId}`);
  return latest;
}

function registryByteLength(project: string): number {
  return readFileSync(join(project, ".autoloop", "registry.jsonl"), "utf-8")
    .length;
}

describe("integration: control abandon retires waiting parks (T-033)", () => {
  it("abandons a parked run: registry stopped/abandoned, journal transition, waiting count drops", async () => {
    const project = makeTempProject("abandon-park");
    const first = runCli(
      ["run", project, "park forever then abandon", "--max-iterations", "4"],
      { MOCK_FIXTURE_PATH: ZERO_FIXTURE },
    );
    expect(first.status).toBe(0);
    const runId = soleRunId(project);
    expect(lastRegistryRecord(project, runId).status).toBe("waiting");

    const healthBefore = runCli(
      ["loops", "health"],
      { AUTOLOOP_PROJECT_DIR: project },
      project,
    );
    expect(healthBefore.stdout).toContain("1 waiting");

    const abandon = runCli(
      ["control", "abandon", runId, "-m", "T-033 verify gate"],
      { AUTOLOOP_PROJECT_DIR: project },
      project,
    );
    expect(abandon.status).toBe(0);
    expect(abandon.stdout).toContain("waiting -> stopped");

    const after = lastRegistryRecord(project, runId);
    expect(after.status).toBe("stopped");
    expect(after.stop_reason).toBe("abandoned");
    expect(after.pid).toBeUndefined();

    const healthAfter = runCli(
      ["loops", "health"],
      { AUTOLOOP_PROJECT_DIR: project },
      project,
    );
    expect(healthAfter.stdout).not.toContain("1 waiting");
    // "All clear" is the health renderer's zero-state (no waiting bucket shown).
    expect(healthAfter.stdout).toContain("All clear");

    const journal = readFileSync(
      join(project, ".autoloop", "journal.jsonl"),
      "utf-8",
    );
    expect(journal).toContain('"topic": "wait.close"');
    expect(journal).toContain('"reason": "abandoned"');
  });

  it("refuses to abandon a non-waiting run; registry byte-unchanged (append-only proof)", () => {
    const project = makeTempProject("abandon-refuse");
    const first = runCli(
      ["run", project, "complete quickly", "--max-iterations", "4"],
      { MOCK_FIXTURE_PATH: COMPLETE_FIXTURE },
    );
    expect(first.status).toBe(0);
    const runId = soleRunId(project);
    expect(lastRegistryRecord(project, runId).status).toBe("completed");

    const bytesBefore = registryByteLength(project);
    const abandon = runCli(
      ["control", "abandon", runId, "-m", "must refuse"],
      { AUTOLOOP_PROJECT_DIR: project },
      project,
    );
    expect(abandon.status).toBe(1);
    expect(abandon.stdout).toContain("not waiting");
    // Byte-diff proof: the refusal appended no line and rewrote nothing.
    expect(registryByteLength(project)).toBe(bytesBefore);
  });
});
