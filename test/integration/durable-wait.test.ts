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
  const lines = readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean);
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

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("integration: durable wait.request (T-008 verify gate)", () => {
  it("parks, exits 0, stays process-free, then resumes on the same run_id", () => {
    const project = makeTempProject("durable-wait");
    const first = runCli(
      ["run", project, "park between company steps", "--max-iterations", "4"],
      { MOCK_FIXTURE_PATH: join(FIXTURES_DIR, "wait-request.json") },
    );

    // 3. process exits 0 while waiting
    expect(first.status).toBe(0);

    const runId = soleRunId(project);
    expect(runId).toBeTruthy();
    const parkedJournal = journalOf(project);
    const parked = registryRecord(project, runId);

    // 1. wait.request
    expect(parkedJournal).toContain('"topic": "wait.request"');
    expect(parkedJournal).toContain("company-nap");
    expect(parkedJournal).toContain("between company steps");

    // 5. wait.open
    expect(parkedJournal).toContain('"topic": "wait.open"');
    expect(parkedJournal).toContain('"wait_id": "company-nap"');
    expect(first.stderr).toContain("[wait] parked run");
    expect(first.stderr).toContain(`autoloop resume ${runId}`);

    // 2. waiting state with no live backend process
    expect(parked.status).toBe("waiting");
    expect(parked.stop_reason).toBe("waiting");
    expect(parked.pid).toBeUndefined();
    expect(existsSync(join(project, ".autoloop", "runs", runId))).toBe(true);

    // 4. no backend burning timeout during the wait — the iteration that
    // requested the wait produced exactly one backend.start, then parked.
    const backendsBefore = topicCount(parkedJournal, "backend.start");
    expect(backendsBefore).toBe(1);
    expect(parkedJournal).not.toContain('"topic": "wait.close"');
    expect(parkedJournal).not.toContain('"topic": "loop.resume"');

    // Default loops list includes parked waits (live, not hidden).
    const loops = runCli(["loops", "--json"], {}, project);
    expect(loops.status).toBe(0);
    expect(loops.stdout).toContain(runId);
    expect(loops.stdout).toContain('"status": "waiting"');

    // Resume on the same run_id with a completing fixture. The parked
    // process is already gone — this is a new process, same journal.
    const resume = runCli(
      ["resume", runId],
      { MOCK_FIXTURE_PATH: join(FIXTURES_DIR, "complete-success.json") },
      project,
    );
    expect(resume.status).toBe(0);
    expect(resume.stdout).toContain(`resumed ${runId}`);

    const resumedJournal = journalOf(project);
    const finished = registryRecord(project, runId);

    // 6. resume  7. wait.close  8. same run_id throughout
    expect(resumedJournal).toContain('"topic": "wait.close"');
    expect(resumedJournal).toContain('"topic": "loop.resume"');
    expect(resume.stderr).toContain("[wait] closed company-nap");
    expect(finished.run_id).toBe(runId);
    expect(parked.run_id).toBe(runId);

    // After wait.close the loop invoked the backend again (new process).
    expect(topicCount(resumedJournal, "backend.start")).toBeGreaterThan(
      backendsBefore,
    );
    expect(resumedJournal).toContain('"topic": "loop.complete"');

    // The parked pid never came back — waiting was process-free.
    if (parked.pid !== undefined) {
      expect(pidAlive(parked.pid)).toBe(false);
    }
  });
});
