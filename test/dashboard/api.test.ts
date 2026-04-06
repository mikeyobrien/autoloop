import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../src/dashboard/app.js";

function makeTempRegistry(): { registryPath: string; projectDir: string } {
  const projectDir = mkdtempSync(join(tmpdir(), "dashboard-api-test-"));
  const registryDir = join(projectDir, ".autoloop");
  mkdirSync(registryDir, { recursive: true });
  return { registryPath: join(registryDir, "registry.jsonl"), projectDir };
}

describe("dashboard /api/runs", () => {
  it("returns watching bucket for runs in the warning band", async () => {
    const { registryPath, projectDir } = makeTempRegistry();

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
    const { registryPath, projectDir } = makeTempRegistry();

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
