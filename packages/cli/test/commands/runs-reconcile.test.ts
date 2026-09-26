import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRun } from "@mobrienv/autoloop-core/registry/read";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchRuns } from "../../src/commands/runs.js";

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "runs-reconcile-"));
  mkdirSync(join(projectDir, ".autoloop"), { recursive: true });
  vi.stubEnv("AUTOLOOP_PROJECT_DIR", projectDir);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(projectDir, { recursive: true, force: true });
});

describe("runs clean --reconcile", () => {
  it("stops a run whose process is gone and drops its step in flight", () => {
    const regPath = join(projectDir, ".autoloop", "registry.jsonl");
    writeFileSync(
      regPath,
      `${JSON.stringify({
        run_id: "gone-run",
        status: "running",
        pid: 2_147_483_646,
        iteration: 1,
        current_step: {
          iteration: 2,
          role: "critic",
          backend_kind: "command",
          model: "",
          started_at: "2026-01-01T00:00:00Z",
        },
      })}\n`,
    );

    dispatchRuns(["clean", "--reconcile"]);

    const r = getRun(regPath, "gone-run");
    expect(r?.status).toBe("stopped");
    expect(r?.stop_reason).toBe("reconciled: process gone");
    expect(r?.current_step).toBeUndefined();
  });
});
