import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../src/dashboard/app.js";

function makeTempRegistry(): { registryPath: string; projectDir: string; stateDir: string } {
  const projectDir = mkdtempSync(join(tmpdir(), "dashboard-api-test-"));
  const stateDir = join(projectDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  return { registryPath: join(stateDir, "registry.jsonl"), projectDir, stateDir };
}

describe("dashboard /api/runs", () => {
  it("returns watching bucket for runs in the warning band", async () => {
    const { registryPath, projectDir, stateDir } = makeTempRegistry();

    // autosimplify warningAfterMs = 2min, stuckAfterMs = 6min
    // 3min old → watching
    const updatedAt = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const record = JSON.stringify({
      run_id: "run-api-watch-001",
      status: "running",
      preset: "autosimplify",
      objective: "test watching",
      trigger: "cli",
      project_dir: projectDir,
      work_dir: projectDir,
      state_dir: join(projectDir, ".autoloop"),
      journal_file: join(projectDir, ".autoloop", "journal.jsonl"),
      parent_run_id: "",
      backend: "mock",
      backend_args: [],
      created_at: updatedAt,
      updated_at: updatedAt,
      iteration: 2,
      stop_reason: "",
      latest_event: "iteration.finish",
    });
    writeFileSync(registryPath, record + "\n", "utf-8");

    const app = createApp({
      registryPath,
      journalPath: join(projectDir, ".autoloop", "journal.jsonl"),
      stateDir,
      bundleRoot: projectDir,
      projectDir,
      selfCmd: "autoloop",
    });

    const res = await app.request("/api/runs");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.watching).toHaveLength(1);
    expect(body.watching[0].run_id).toBe("run-api-watch-001");
    expect(body.active).toHaveLength(0);
    expect(body.stuck).toHaveLength(0);
  });

  it("returns stuck bucket for runs past the stuck threshold", async () => {
    const { registryPath, projectDir, stateDir } = makeTempRegistry();

    // autosimplify stuckAfterMs = 6min; 7min old → stuck
    const updatedAt = new Date(Date.now() - 7 * 60 * 1000).toISOString();
    const record = JSON.stringify({
      run_id: "run-api-stuck-001",
      status: "running",
      preset: "autosimplify",
      objective: "test stuck",
      trigger: "cli",
      project_dir: projectDir,
      work_dir: projectDir,
      state_dir: join(projectDir, ".autoloop"),
      journal_file: join(projectDir, ".autoloop", "journal.jsonl"),
      parent_run_id: "",
      backend: "mock",
      backend_args: [],
      created_at: updatedAt,
      updated_at: updatedAt,
      iteration: 2,
      stop_reason: "",
      latest_event: "iteration.finish",
    });
    writeFileSync(registryPath, record + "\n", "utf-8");

    const app = createApp({
      registryPath,
      journalPath: join(projectDir, ".autoloop", "journal.jsonl"),
      stateDir,
      bundleRoot: projectDir,
      projectDir,
      selfCmd: "autoloop",
    });

    const res = await app.request("/api/runs");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stuck).toHaveLength(1);
    expect(body.watching).toHaveLength(0);
  });
});

describe("dashboard /api/runs/:id/events", () => {
  function makeEvent(runId: string, topic: string, seq: number) {
    return JSON.stringify({ run: runId, topic, seq, timestamp: new Date().toISOString() });
  }

  it("returns events from the shared journal for a shared run", async () => {
    const { registryPath, projectDir, stateDir } = makeTempRegistry();
    const journalPath = join(stateDir, "journal.jsonl");

    const events = [
      makeEvent("run-shared-001", "loop.start", 1),
      makeEvent("run-shared-001", "iteration.start", 2),
      makeEvent("run-other-999", "loop.start", 1),
    ];
    writeFileSync(journalPath, events.join("\n") + "\n", "utf-8");

    const app = createApp({
      registryPath,
      journalPath,
      stateDir,
      bundleRoot: projectDir,
      projectDir,
      selfCmd: "autoloop",
    });

    const res = await app.request("/api/runs/run-shared-001/events");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(2);
    expect(body.events[0].topic).toBe("loop.start");
    expect(body.events[1].topic).toBe("iteration.start");
  });

  it("returns events from a run-scoped journal", async () => {
    const { registryPath, projectDir, stateDir } = makeTempRegistry();
    const journalPath = join(stateDir, "journal.jsonl");

    // Write a decoy event to the shared journal
    writeFileSync(journalPath, makeEvent("run-scoped-001", "decoy", 0) + "\n", "utf-8");

    // Write real events to the run-scoped journal
    const runDir = join(stateDir, "runs", "run-scoped-001");
    mkdirSync(runDir, { recursive: true });
    const runJournal = join(runDir, "journal.jsonl");
    const events = [
      makeEvent("run-scoped-001", "loop.start", 1),
      makeEvent("run-scoped-001", "tasks.ready", 2),
      makeEvent("run-scoped-001", "review.passed", 3),
    ];
    writeFileSync(runJournal, events.join("\n") + "\n", "utf-8");

    const app = createApp({
      registryPath,
      journalPath,
      stateDir,
      bundleRoot: projectDir,
      projectDir,
      selfCmd: "autoloop",
    });

    const res = await app.request("/api/runs/run-scoped-001/events");
    expect(res.status).toBe(200);
    const body = await res.json();
    // Should read from the run-scoped journal, not the shared one
    expect(body.events).toHaveLength(3);
    expect(body.events[0].topic).toBe("loop.start");
    expect(body.events[2].topic).toBe("review.passed");
  });

  it("returns events from a worktree journal", async () => {
    const { registryPath, projectDir, stateDir } = makeTempRegistry();
    const journalPath = join(stateDir, "journal.jsonl");
    writeFileSync(journalPath, "", "utf-8");

    // Write events to the worktree journal path
    const wtJournalDir = join(stateDir, "worktrees", "run-wt-001", "tree", ".autoloop");
    mkdirSync(wtJournalDir, { recursive: true });
    const wtJournal = join(wtJournalDir, "journal.jsonl");
    const events = [
      makeEvent("run-wt-001", "loop.start", 1),
      makeEvent("run-wt-001", "build.blocked", 2),
    ];
    writeFileSync(wtJournal, events.join("\n") + "\n", "utf-8");

    const app = createApp({
      registryPath,
      journalPath,
      stateDir,
      bundleRoot: projectDir,
      projectDir,
      selfCmd: "autoloop",
    });

    const res = await app.request("/api/runs/run-wt-001/events");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(2);
    expect(body.events[0].topic).toBe("loop.start");
    expect(body.events[1].topic).toBe("build.blocked");
  });
});
