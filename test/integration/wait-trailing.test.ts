import { readdirSync, readFileSync } from "node:fs";
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

const TRAILING_FIXTURE = join(FIXTURES_DIR, "wait-request-trailing.json");

function soleRunId(project: string): string {
  const [runId] = readdirSync(join(project, ".autoloop", "runs"));
  return runId;
}

function journalOf(project: string): string {
  return readFileSync(join(project, ".autoloop", "journal.jsonl"), "utf-8");
}

function registryRecord(
  project: string,
  runId: string,
): { status: string; stop_reason: string; pid?: number; run_id: string } {
  const path = join(project, ".autoloop", "registry.jsonl");
  const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
  let latest: {
    status: string;
    stop_reason: string;
    pid?: number;
    run_id: string;
  } | null = null;
  for (const line of lines) {
    const rec = JSON.parse(line) as {
      status: string;
      stop_reason: string;
      pid?: number;
      run_id: string;
    };
    if (rec.run_id === runId) latest = rec;
  }
  if (!latest) throw new Error(`no registry record for ${runId}`);
  return latest;
}

function topicCount(journal: string, topic: string): number {
  return journal
    .split("\n")
    .filter((line) => line.includes(`"topic": "${topic}"`)).length;
}

function eventIteration(journal: string, topic: string): string | null {
  for (const line of journal.split("\n")) {
    if (!line.includes(`"topic": "${topic}"`)) continue;
    try {
      const ev = JSON.parse(line) as { iteration?: string };
      return ev.iteration ?? null;
    } catch {
      /* skip */
    }
  }
  return null;
}

describe("integration: wait.request with a trailing allowed emit still parks (T-031 verify gate)", () => {
  it("parks: registry waiting, process-free, wait.open, zero next-iteration start", async () => {
    const project = makeTempProject("wait-trailing");
    const first = runCli(
      [
        "run",
        project,
        "park even after trailing emit",
        "--max-iterations",
        "4",
      ],
      { MOCK_FIXTURE_PATH: TRAILING_FIXTURE },
    );
    expect(first.status).toBe(0);
    const runId = soleRunId(project);
    const journal = journalOf(project);
    const parked = registryRecord(project, runId);

    // The turn really carried both events (the trailing platform of the repro).
    expect(journal).toContain('"topic": "wait.request"');
    // tasks.ready is the minimal-preset allowed next event from loop.start —
    // a trailing ALLOWED emit, i.e. the exact nullification surface of T-031.
    expect(journal).toContain('"topic": "tasks.ready"');

    // The park happened despite the trailing emit: wait.open + loop.stop.
    expect(journal).toContain('"topic": "wait.open"');
    expect(journal).toContain('"wait_id": "trailing-park"');
    expect(journal).toContain('"topic": "loop.stop"');
    expect(journal).toContain('"reason": "waiting"');

    // Process-free parked registry state.
    expect(parked.status).toBe("waiting");
    expect(parked.pid).toBeUndefined();

    // ZERO next-iteration start: exactly one iteration ran before parking.
    expect(topicCount(journal, "iteration.start")).toBe(1);

    // The park is journaled on the FINISHED turn (iteration 1) — the turn
    // that carried wait.request — never deferred to a later iteration.
    expect(eventIteration(journal, "wait.open")).toBe("1");

    // Indefinite park (duration=0s): no wait.close / loop.resume machinery.
    expect(topicCount(journal, "wait.close")).toBe(0);
    expect(topicCount(journal, "loop.resume")).toBe(0);
  });
});
