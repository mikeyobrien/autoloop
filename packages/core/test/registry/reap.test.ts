import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRun } from "@mobrienv/autoloop-core/registry/read";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { reapStaleRuns } from "@mobrienv/autoloop-core/runs-health";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "reap-"));
  mkdirSync(stateDir, { recursive: true });
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe("reapStaleRuns", () => {
  it("stops a dead-pid run and drops its step in flight", () => {
    const regPath = join(stateDir, "registry.jsonl");
    const record = {
      run_id: "dead-run",
      status: "running",
      pid: 2_147_483_646,
      updated_at: "2026-01-01T00:00:00Z",
      iteration: 2,
      current_step: {
        iteration: 3,
        role: "builder",
        backend_kind: "pi",
        model: "",
        started_at: "2026-01-01T00:00:00Z",
      },
    } as unknown as RunRecord;
    writeFileSync(regPath, `${JSON.stringify(record)}\n`);

    expect(reapStaleRuns(stateDir)).toBe(1);
    const reaped = getRun(regPath, "dead-run");
    expect(reaped?.status).toBe("stopped");
    expect(reaped?.iteration).toBe(2);
    expect(reaped?.current_step).toBeUndefined();
  });
});
