import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureBuild, makeTempProject, runCli } from "../helpers/runtime.js";

beforeAll(() => {
  ensureBuild();
});

function appendConfig(project: string, toml: string): void {
  const configPath = join(project, "autoloops.toml");
  const existing = readFileSync(configPath, "utf-8");
  writeFileSync(configPath, `${existing}\n${toml}\n`, "utf-8");
}

describe("integration: autoloop hooks CLI", () => {
  it("hooks list shows configured hooks grouped by phase", () => {
    const project = makeTempProject("hooks-cli-list");
    appendConfig(
      project,
      [
        "[hooks]",
        'pre_run = "echo legacy"',
        "",
        "[[hook]]",
        'phase = "pre_iteration"',
        'command = "echo structured"',
        'on_error = "block"',
        'mutate = "prompt"',
      ].join("\n"),
    );

    const res = runCli(["hooks", "list", project], {});
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("pre_run:");
    expect(res.stdout).toContain("echo legacy");
    expect(res.stdout).toContain("pre_iteration:");
    expect(res.stdout).toContain("echo structured");
    expect(res.stdout).toContain("on_error=block");
    expect(res.stdout).toContain("mutate=prompt");
  });

  it("hooks list --json emits machine-readable hook specs", () => {
    const project = makeTempProject("hooks-cli-list-json");
    appendConfig(
      project,
      ["[[hook]]", 'phase = "post_run"', 'command = "echo done"'].join("\n"),
    );

    const res = runCli(["hooks", "list", project, "--json"], {});
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.hooks).toHaveLength(1);
    expect(parsed.hooks[0]).toMatchObject({
      phase: "post_run",
      command: "echo done",
      onError: "warn",
      mutate: "none",
    });
  });

  it("hooks show <phase> displays only that phase's hooks", () => {
    const project = makeTempProject("hooks-cli-show");
    appendConfig(
      project,
      [
        "[[hook]]",
        'phase = "pre_emit"',
        'command = "echo pre-emit-hook"',
        'mutate = "event"',
        "",
        "[[hook]]",
        'phase = "post_emit"',
        'command = "echo post-emit-hook"',
      ].join("\n"),
    );

    const res = runCli(["hooks", "show", "pre_emit", project], {});
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("pre-emit-hook");
    expect(res.stdout).not.toContain("post-emit-hook");
  });

  it("hooks show with an unknown phase fails clearly", () => {
    const project = makeTempProject("hooks-cli-show-bad");
    const res = runCli(["hooks", "show", "not_a_phase", project], {});
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("unknown phase");
  });

  it("hooks validate succeeds on a well-formed config", () => {
    const project = makeTempProject("hooks-cli-validate-ok");
    appendConfig(
      project,
      ["[[hook]]", 'phase = "pre_run"', 'command = "echo ok"'].join("\n"),
    );

    const res = runCli(["hooks", "validate", project], {});
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("valid");
  });

  it("hooks validate exits non-zero and reports errors for a bad policy/phase", () => {
    const project = makeTempProject("hooks-cli-validate-bad");
    appendConfig(
      project,
      [
        "[[hook]]",
        'phase = "not_a_real_phase"',
        'command = "echo hi"',
        'on_error = "not_a_real_policy"',
      ].join("\n"),
    );

    const res = runCli(["hooks", "validate", project], {});
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("phase must be one of");
    expect(res.stdout).toContain("on_error must be one of");
  });

  it("hooks validate --json reports structured errors", () => {
    const project = makeTempProject("hooks-cli-validate-json");
    appendConfig(
      project,
      ["[[hook]]", 'phase = "pre_run"'].join("\n"), // missing command
    );

    const res = runCli(["hooks", "validate", project, "--json"], {});
    expect(res.status).not.toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.errors[0].field).toBe("command");
  });

  it("hooks clear-suspend reports nothing to clear when no suspend state exists", () => {
    const project = makeTempProject("hooks-cli-clear-noop");
    const res = runCli(["hooks", "clear-suspend", project], {});
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("No suspend state");
  });

  it("hooks --help / bare hooks prints usage", () => {
    const res = runCli(["hooks"], {});
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("autoloop hooks");
    expect(res.stdout).toContain("clear-suspend");
  });
});
