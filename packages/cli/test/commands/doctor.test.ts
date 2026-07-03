import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchDoctor,
  renderDoctorReport,
  runDoctorChecks,
} from "../../src/commands/doctor.js";

function registryLine(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    run_id: "run-x",
    status: "completed",
    preset: "autocode",
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:10:00Z",
    iteration: 3,
    ...overrides,
  });
}

describe("doctor", () => {
  let projectDir: string;
  let stateDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "autoloop-doctor-test-"));
    stateDir = join(projectDir, ".autoloop");
    mkdirSync(stateDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function check(name: string) {
    const found = runDoctorChecks(projectDir).find((c) => c.name === name);
    expect(found, `check ${name} should exist`).toBeDefined();
    return found as { name: string; status: string; detail: string };
  }

  it("reports ok for a healthy empty state dir", () => {
    expect(check("node").status).toBe("ok");
    expect(check("state").status).toBe("ok");
    expect(check("registry").status).toBe("ok");
    expect(check("runs").status).toBe("ok");
    expect(check("waves").status).toBe("ok");
    expect(check("worktrees").status).toBe("ok");
  });

  it("flags a trivial/un-falsifiable completion contract", () => {
    // No verify_cmds, no required_events, trivial promise → un-falsifiable.
    writeFileSync(
      join(projectDir, "autoloops.toml"),
      '[event_loop]\ncompletion_promise = "done"\n',
    );
    const c = check("completion-contract");
    expect(c.status).toBe("warn");
    expect(c.detail).toContain("unfalsifiable_completion");
  });

  it("passes a well-formed completion contract (deterministic check)", () => {
    writeFileSync(
      join(projectDir, "autoloops.toml"),
      '[acceptance]\nverify_cmd = "npm test"\n',
    );
    expect(check("completion-contract").status).toBe("ok");
  });

  it("warns when the state dir does not exist yet", () => {
    rmSync(stateDir, { recursive: true, force: true });
    const checks = runDoctorChecks(projectDir);
    const state = checks.find((c) => c.name === "state");
    expect(state?.status).toBe("warn");
    // State-tree checks are skipped when there is no state tree.
    expect(checks.find((c) => c.name === "registry")).toBeUndefined();
  });

  it("flags runs marked running whose process is gone", () => {
    writeFileSync(
      join(stateDir, "registry.jsonl"),
      `${registryLine({ run_id: "dead-run", status: "running", pid: 2 ** 30 })}\n`,
    );
    const runs = check("runs");
    expect(runs.status).toBe("warn");
    expect(runs.detail).toContain("dead-run");
  });

  it("accepts a running run whose process is alive", () => {
    writeFileSync(
      join(stateDir, "registry.jsonl"),
      `${registryLine({ run_id: "live-run", status: "running", pid: process.pid })}\n`,
    );
    expect(check("runs").status).toBe("ok");
  });

  it("warns about malformed registry lines", () => {
    writeFileSync(
      join(stateDir, "registry.jsonl"),
      `${registryLine({})}\nnot-json\n`,
    );
    const registry = check("registry");
    expect(registry.status).toBe("warn");
    expect(registry.detail).toContain("1 malformed");
  });

  it("flags a stale wave marker with no running runs", () => {
    mkdirSync(join(stateDir, "waves"), { recursive: true });
    writeFileSync(join(stateDir, "waves", "active"), "wave-1");
    const waves = check("waves");
    expect(waves.status).toBe("warn");
    expect(waves.detail).toContain("stale wave marker");
  });

  it("accepts a wave marker while a run is alive", () => {
    mkdirSync(join(stateDir, "waves"), { recursive: true });
    writeFileSync(join(stateDir, "waves", "active"), "wave-1");
    writeFileSync(
      join(stateDir, "registry.jsonl"),
      `${registryLine({ status: "running", pid: process.pid })}\n`,
    );
    expect(check("waves").status).toBe("ok");
  });

  it("renders a summary line with counts", () => {
    const report = renderDoctorReport(projectDir, [
      { name: "a", status: "ok", detail: "fine" },
      { name: "b", status: "warn", detail: "meh" },
      { name: "c", status: "fail", detail: "bad" },
    ]);
    expect(report).toContain("autoloop doctor");
    expect(report).toContain("1 failure(s), 1 warning(s)");
  });

  it("dispatch prints JSON with --json", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });
    dispatchDoctor([projectDir, "--json"]);
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed.projectDir).toBe(projectDir);
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed.checks.length).toBeGreaterThan(0);
  });

  it("dispatch prints a human report by default", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });
    dispatchDoctor([projectDir]);
    expect(lines.join("\n")).toContain("autoloop doctor");
  });

  it("dispatch shows usage with --help", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });
    dispatchDoctor(["--help"]);
    expect(lines.join("\n")).toContain("Usage: autoloop doctor");
  });

  it("reports ok runtime limits when unset", () => {
    const limits = check("runtime limits");
    expect(limits.status).toBe("ok");
    expect(limits.detail).toContain("max_iteration_runtime=off");
    expect(limits.detail).toContain("max_runtime=off");
  });

  it("summarizes configured runtime limits", () => {
    writeFileSync(
      join(projectDir, "autoloops.toml"),
      ['event_loop.max_iteration_runtime = "12h"'].join("\n"),
    );
    const limits = check("runtime limits");
    expect(limits.status).toBe("ok");
    expect(limits.detail).toContain("max_iteration_runtime=43200000ms");
  });

  it("warns on unparseable runtime limit values", () => {
    writeFileSync(
      join(projectDir, "autoloops.toml"),
      'event_loop.max_runtime = "forever"\n',
    );
    const limits = check("runtime limits");
    expect(limits.status).toBe("warn");
    expect(limits.detail).toContain("not a valid duration");
  });

  it("warns when the iteration cap exceeds the loop budget", () => {
    writeFileSync(
      join(projectDir, "autoloops.toml"),
      [
        'event_loop.max_iteration_runtime = "3d"',
        'event_loop.max_runtime = "1h"',
      ].join("\n"),
    );
    const limits = check("runtime limits");
    expect(limits.status).toBe("warn");
    expect(limits.detail).toContain("clamped to the remaining loop budget");
  });

  it("warns when a runtime limit exceeds the Node timer cap", () => {
    writeFileSync(
      join(projectDir, "autoloops.toml"),
      'event_loop.max_iteration_runtime = "30d"\n',
    );
    const limits = check("runtime limits");
    expect(limits.status).toBe("warn");
    expect(limits.detail).toContain("Node timer limit");
  });
});
