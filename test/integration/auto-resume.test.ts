import { existsSync, readdirSync, readFileSync } from "node:fs";
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

const DURATION_FIXTURE = join(FIXTURES_DIR, "wait-request-duration.json");
const SLOW_FIXTURE = join(FIXTURES_DIR, "wait-request-duration-5s.json");
const ZERO_FIXTURE = join(FIXTURES_DIR, "wait-request-zero.json");
const COMPLETE_FIXTURE = join(FIXTURES_DIR, "complete-success.json");

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

function eventsForRun(
  journal: string,
  topic: string,
  runId: string,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of journal.split("\n")) {
    if (!line.includes(`"topic": "${topic}"`)) continue;
    try {
      const ev = JSON.parse(line) as { run?: string };
      if (ev.run === runId) out.push(ev);
    } catch {
      /* skip */
    }
  }
  return out;
}

async function pollUntil(
  cond: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

function stateDirOf(project: string, runId: string): string {
  return join(project, ".autoloop", "runs", runId);
}

describe("integration: wait.request duration auto-resume (T-030 verify gate)", () => {
  it("auto-resumes after durationMs via the existing resume path — no manual Wake, no /ops", async () => {
    const project = makeTempProject("auto-resume");
    const first = runCli(
      ["run", project, "park 2s then auto-resume", "--max-iterations", "4"],
      { MOCK_FIXTURE_PATH: DURATION_FIXTURE },
    );
    expect(first.status).toBe(0);

    const runId = soleRunId(project);
    const parkedJournal = journalOf(project);
    const parked = registryRecord(project, runId);

    // 1. Parked state: wait.open journals the duration; registry waiting and
    //    process-free (no pid — the engine exited 0).
    expect(parkedJournal).toContain('"topic": "wait.open"');
    expect(parkedJournal).toContain('"wait_id": "auto-demo"');
    expect(parkedJournal).toContain('"duration_ms": "2000"');
    expect(parked.status).toBe("waiting");
    expect(parked.pid).toBeUndefined();

    // 2. The detached engine-spawned timer child exists (nothing to do with
    //    /ops or a second supervisor).
    const logPath = join(stateDirOf(project, runId), "auto-resume.log");
    await pollUntil(
      () => existsSync(logPath),
      10_000,
      "auto-resume.log to exist (timer child spawned)",
    );

    // 3. NO manual resume was issued. The timer itself must fire the EXISTING
    //    resume path: wait.close + loop.resume on the same run_id.
    await pollUntil(
      () =>
        eventsForRun(journalOf(project), "wait.close", runId).length >= 1 &&
        eventsForRun(journalOf(project), "loop.resume", runId).length >= 1,
      20_000,
      "wait.close + loop.resume after duration",
    );

    // 4. The resumed loop runs to completion (one-shot emit prevents a
    //    re-park cycle) — proving the fired resume drove a real engine.
    await pollUntil(
      () => registryRecord(project, runId).status === "completed",
      20_000,
      "loop to complete after auto-resume",
    );

    const journal = journalOf(project);
    // 5. One wait.close per wait.open; no double close from racing a manual
    //    resume (none happened here).
    expect(topicCount(journal, "wait.open")).toBe(1);
    expect(topicCount(journal, "wait.close")).toBe(1);
    expect(topicCount(journal, "loop.resume")).toBe(1);

    // 6. Same run_id through park -> auto-resume -> completion.
    expect(eventsForRun(journal, "wait.open", runId).length).toBe(1);
    expect(eventsForRun(journal, "wait.close", runId).length).toBe(1);
    expect(eventsForRun(journal, "loop.resume", runId).length).toBe(1);

    // 7. The detached child's own log proves it took the action (this is the
    //    zero-/ops-POSTs evidence: no host was involved).
    const log = readFileSync(logPath, "utf-8");
    expect(log).toContain("firing resume");
    expect(log).toContain(runId);
  });

  it("manual resume first: the late timer re-checks and skips (idempotent, one wait.close)", async () => {
    const project = makeTempProject("auto-resume-manual-first");
    const first = runCli(
      [
        "run",
        project,
        "park 5s but manual resume wins",
        "--max-iterations",
        "4",
      ],
      { MOCK_FIXTURE_PATH: SLOW_FIXTURE },
    );
    expect(first.status).toBe(0);
    const runId = soleRunId(project);

    // Manual Wake immediately (well before the 5s duration) with a completing
    // fixture.
    const manual = runCli(
      ["resume", runId],
      { MOCK_FIXTURE_PATH: COMPLETE_FIXTURE },
      project,
    );
    expect(manual.status).toBe(0);
    expect(manual.stdout).toContain(`resumed ${runId}`);

    // Let the run fully complete AND the armed timer pass its fire time.
    await pollUntil(
      () => registryRecord(project, runId).status === "completed",
      20_000,
      "manual resume to complete the run",
    );
    // The timer fires at park+5s; wait for its skip line instead of a blind
    // sleep — immune to scheduling variance.
    await pollUntil(
      () => {
        const p = join(stateDirOf(project, runId), "auto-resume.log");
        return (
          existsSync(p) && readFileSync(p, "utf-8").includes("skip run_id=")
        );
      },
      15_000,
      "late timer to re-check and skip",
    );

    const journal = journalOf(project);
    // The manual resume produced exactly one close/resume; the late timer
    // skipped — no double wait.close, no second loop.resume.
    expect(topicCount(journal, "wait.close")).toBe(1);
    expect(topicCount(journal, "loop.resume")).toBe(1);
    expect(topicCount(journal, "loop.complete")).toBe(1);

    const log = readFileSync(
      join(stateDirOf(project, runId), "auto-resume.log"),
      "utf-8",
    );
    expect(log).toContain("skip run_id=");
    expect(log).toContain(runId);
    expect(log).not.toContain("firing resume");
  });

  it("duration=0 parks indefinitely with no timer child (behavior unchanged)", async () => {
    const project = makeTempProject("auto-resume-zero");
    const first = runCli(
      ["run", project, "park forever", "--max-iterations", "4"],
      { MOCK_FIXTURE_PATH: ZERO_FIXTURE },
    );
    expect(first.status).toBe(0);
    const runId = soleRunId(project);

    // Give any (wrongly-armed) timer a chance to fire.
    await new Promise((r) => setTimeout(r, 2_500));

    const parked = registryRecord(project, runId);
    expect(parked.status).toBe("waiting");
    expect(parked.pid).toBeUndefined();

    const journal = journalOf(project);
    expect(journal).toContain('"topic": "wait.request"');
    expect(journal).toContain('"topic": "wait.open"');
    expect(journal).toContain('"duration": "0s"');
    expect(topicCount(journal, "wait.close")).toBe(0);
    expect(topicCount(journal, "loop.resume")).toBe(0);

    // No timer child was spawned: no auto-resume.log, no auto resume.
    expect(
      existsSync(join(stateDirOf(project, runId), "auto-resume.log")),
    ).toBe(false);
  });
});
