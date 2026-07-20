// Integration tests for the agent-ergonomics contract:
//   - errors go to stderr with a non-zero exit code
//   - mistyped commands/subcommands/flags get "Did you mean" corrections
//   - --version / help / capabilities / robot-docs / triage surfaces exist
//   - stdout stays data-only so `--json | jq` always works
//
// These pin recommendations R-001..R-010 from agent_ergonomics_audit/.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupTempProjects,
  ensureBuild,
  expectCliStatus,
  makeTempProject,
  runCli,
} from "../helpers/runtime.js";

beforeAll(() => {
  ensureBuild();
});

afterAll(() => {
  cleanupTempProjects();
});

describe("agent surfaces: version and help", () => {
  it("--version prints a semver on stdout and exits 0", () => {
    const res = runCli(["--version"], {}, ".");
    expectCliStatus(res, 0);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("`version` word form works", () => {
    const res = runCli(["version"], {}, ".");
    expectCliStatus(res, 0);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("bare invocation prints usage, not a run error", () => {
    const res = runCli([], {}, ".");
    expectCliStatus(res, 0);
    expect(res.stdout).toContain("autoloop — autonomous LLM loop harness");
    expect(res.stdout).not.toContain("error:");
  });

  it("`help` word form prints usage", () => {
    const res = runCli(["help"], {}, ".");
    expectCliStatus(res, 0);
    expect(res.stdout).toContain("Usage:");
  });

  it("`help loops` shows loops usage", () => {
    const res = runCli(["help", "loops"], {}, ".");
    expectCliStatus(res, 0);
    expect(res.stdout).toContain("autoloop loops");
  });

  it("--help mentions the agent surfaces and exit codes", () => {
    const res = runCli(["--help"], {}, ".");
    expectCliStatus(res, 0);
    expect(res.stdout).toContain("capabilities");
    expect(res.stdout).toContain("robot-docs");
    expect(res.stdout).toContain("triage");
    expect(res.stdout).toContain("Exit codes:");
  });
});

describe("agent surfaces: error contract (stderr + non-zero exit)", () => {
  it("mistyped command suggests the correction and never runs a preset", () => {
    const res = runCli(["staus"], {}, ".");
    expectCliStatus(res, 1);
    expect(res.stderr).toContain("unknown command `staus`");
    expect(res.stderr).toContain("Did you mean `autoloop stats`?");
    expect(res.stdout).toBe("");
  });

  it("plural command form is corrected", () => {
    const res = runCli(["tasks", "list"], {}, ".");
    expectCliStatus(res, 1);
    expect(res.stderr).toContain("Did you mean `autoloop task`?");
  });

  it("unknown preset error goes to stderr with exit 1", () => {
    const res = runCli(["run", "no-such-preset-xyz"], {}, ".");
    expectCliStatus(res, 1);
    expect(res.stderr).toContain("preset `no-such-preset-xyz` not found");
    expect(res.stdout).toBe("");
  });

  it("missing preset argument exits 1 via run subcommand", () => {
    const res = runCli(["run"], {}, ".");
    expectCliStatus(res, 1);
    expect(res.stderr).toContain("missing required preset argument");
  });

  it("loops flag typo gets a Did-you-mean on stderr", () => {
    const res = runCli(["loops", "--jsno"], {}, ".");
    expectCliStatus(res, 1);
    expect(res.stderr).toContain("unknown loops flag `--jsno`");
    expect(res.stderr).toContain("Did you mean `--json`?");
  });

  it("loops show without run-id exits 1 with exact usage", () => {
    const res = runCli(["loops", "show"], {}, ".");
    expectCliStatus(res, 1);
    expect(res.stderr).toContain("autoloop loops show <run-id>");
  });

  it("memory subcommand typo gets a suggestion", () => {
    const res = runCli(["memory", "lst"], {}, ".");
    expectCliStatus(res, 1);
    expect(res.stderr).toContain("Did you mean `list`?");
  });

  it("task subcommand typo gets a suggestion", () => {
    const res = runCli(["task", "ad", "hello"], {}, ".");
    expectCliStatus(res, 1);
    expect(res.stderr).toContain("Did you mean `add`?");
  });

  it("inspect target typo exits 1 with suggestion on stderr", () => {
    const res = runCli(["inspect", "scratchpd"], {}, ".");
    expectCliStatus(res, 1);
    expect(res.stderr).toContain("Did you mean `scratchpad`?");
  });

  it("run --help after a preset shows help instead of starting a loop", () => {
    const res = runCli(["run", "autocode", "--help"], {}, ".");
    expectCliStatus(res, 0);
    expect(res.stdout).toContain("Usage: autoloop run");
    expect(res.stdout).not.toContain("iteration 1/");
  });
});

describe("agent surfaces: capabilities", () => {
  it("emits valid JSON with contract fields", () => {
    const res = runCli(["capabilities"], {}, ".");
    expectCliStatus(res, 0);
    const doc = JSON.parse(res.stdout);
    expect(doc.name).toBe("autoloop");
    expect(doc.contract_version).toBe(1);
    expect(doc.exit_codes["0"]).toBe("success");
    expect(doc.exit_codes["1"]).toContain("user-input");
    expect(Array.isArray(doc.commands)).toBe(true);
    const names = doc.commands.map((c: { name: string }) => c.name);
    expect(names).toContain("run");
    expect(names).toContain("triage");
    expect(names).toContain("doctor");
  });

  it("is deterministic across invocations", () => {
    const a = runCli(["capabilities"], {}, ".");
    const b = runCli(["capabilities"], {}, ".");
    expect(a.stdout).toBe(b.stdout);
  });
});

describe("agent surfaces: robot-docs", () => {
  it("prints the agent handbook on stdout", () => {
    const res = runCli(["robot-docs"], {}, ".");
    expectCliStatus(res, 0);
    expect(res.stdout).toContain("agent handbook");
    expect(res.stdout).toContain("triage --json");
    expect(res.stdout).toContain("Exit codes");
  });
});

describe("agent surfaces: triage mega-command", () => {
  it("triage --json returns runs+health+doctor+stats+commands in one call", () => {
    const project = makeTempProject("triage-json");
    const res = runCli(["triage", project, "--json"], {}, project);
    expectCliStatus(res, 0);
    const doc = JSON.parse(res.stdout);
    expect(doc.quick_ref).toBeDefined();
    expect(doc.health).toBeDefined();
    expect(Array.isArray(doc.doctor)).toBe(true);
    expect(Array.isArray(doc.recommended_commands)).toBe(true);
    expect(doc.recommended_commands.length).toBeGreaterThan(0);
  });

  it("human triage names the --json escape hatch", () => {
    const project = makeTempProject("triage-human");
    const res = runCli(["triage", project], {}, project);
    expectCliStatus(res, 0);
    expect(res.stdout).toContain("autoloop triage --json");
  });
});

describe("agent surfaces: config unset", () => {
  it("config unset removes a key previously written by config set", () => {
    const project = makeTempProject("config-unset");
    const set = runCli(
      [
        "config",
        "set",
        "--repo",
        "--preset",
        "minimal",
        "--project",
        project,
        "event_loop.max_iterations=7",
      ],
      {},
      project,
    );
    expectCliStatus(set, 0);
    expect(set.stdout).toContain("set event_loop.max_iterations=7");

    const unset = runCli(
      [
        "config",
        "unset",
        "--repo",
        "--preset",
        "minimal",
        "--project",
        project,
        "event_loop.max_iterations",
      ],
      {},
      project,
    );
    expectCliStatus(unset, 0);
    expect(unset.stdout).toContain("unset event_loop.max_iterations");

    const again = runCli(
      [
        "config",
        "unset",
        "--repo",
        "--preset",
        "minimal",
        "--project",
        project,
        "event_loop.max_iterations",
      ],
      {},
      project,
    );
    expectCliStatus(again, 1);
    expect(again.stderr).toContain("not set");
  });

  it("config subcommand typo is corrected", () => {
    const res = runCli(["config", "shwo"], {}, ".");
    expectCliStatus(res, 1);
    expect(res.stderr).toContain("Did you mean `show`?");
  });
});
