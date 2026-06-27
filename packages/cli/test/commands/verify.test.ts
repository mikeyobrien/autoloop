import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchVerify } from "../../src/commands/verify.js";

function setupProject(verifyCmd: string): { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-verify-cli-"));
  const stateDir = join(dir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  if (verifyCmd) {
    writeFileSync(
      join(dir, "autoloops.toml"),
      `[acceptance]\nverify_cmd = "${verifyCmd}"\n`,
    );
  }
  const record: RunRecord = {
    run_id: "run-1",
    status: "completed",
    preset: "autocode",
    objective: "",
    trigger: "cli",
    project_dir: dir,
    work_dir: dir,
    state_dir: stateDir,
    journal_file: join(stateDir, "journal.jsonl"),
    parent_run_id: "",
    backend: "",
    backend_args: [],
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:01:00Z",
    iteration: 3,
    max_iterations: 10,
    stop_reason: "completion_event",
    latest_event: "loop.complete",
    isolation_mode: "",
    worktree_name: "",
    worktree_path: "",
  };
  writeFileSync(join(stateDir, "journal.jsonl"), "", "utf-8");
  writeFileSync(
    join(stateDir, "registry.jsonl"),
    `${JSON.stringify(record)}\n`,
  );
  return { dir };
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

function capture(fn: () => void): string {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a) =>
    lines.push(a.join(" ")),
  );
  vi.spyOn(console, "error").mockImplementation((...a) =>
    lines.push(a.join(" ")),
  );
  fn();
  return lines.join("\n");
}

describe("dispatchVerify", () => {
  it("catches a scheduled false done (failing verify) and exits non-zero", () => {
    const { dir } = setupProject("false");
    const out = capture(() => dispatchVerify([dir, "--json"]));
    expect(out).toContain('"reconcile": "false_done"');
    expect(process.exitCode).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("confirms a genuinely-done run (passing verify), exit 0", () => {
    const { dir } = setupProject("true");
    const out = capture(() => dispatchVerify([dir, "--json"]));
    expect(out).toContain('"reconcile": "confirmed"');
    expect(process.exitCode).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("flags an unverifiable claim when no acceptance check is configured", () => {
    const { dir } = setupProject("");
    const out = capture(() => dispatchVerify([dir, "--json"]));
    expect(out).toContain('"reconcile": "unverifiable"');
    expect(process.exitCode).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("errors when the named run is absent", () => {
    const { dir } = setupProject("true");
    capture(() => dispatchVerify([dir, "no-such-run"]));
    expect(process.exitCode).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});
