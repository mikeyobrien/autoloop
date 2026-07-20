import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createApp } from "@mobrienv/autoloop-dashboard";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupTempProjects,
  ensureBuild,
  FIXTURES_DIR,
  MOCK_BACKEND,
  makeTempProject,
  PRESET_FIXTURE_DIR,
  runCli,
} from "../helpers/runtime.js";

const PARENT_STATE_DIR_REL = ".ralph/autoloop";

interface ChildRun {
  run_id: string;
  preset: string;
}

describe("integration: heterogeneous chain child state layout", () => {
  let project = "";
  let childRun: ChildRun;

  beforeAll(() => {
    ensureBuild();
    project = makeTempProject("chain-child-layout");

    const parentConfig = join(project, "autoloops.toml");
    writeFileSync(
      parentConfig,
      readFileSync(parentConfig, "utf-8").replaceAll(
        ".autoloop",
        PARENT_STATE_DIR_REL,
      ),
      "utf-8",
    );

    const childPreset = join(project, "presets", "normal-child");
    cpSync(PRESET_FIXTURE_DIR, childPreset, { recursive: true });
    const childConfig = join(childPreset, "autoloops.toml");
    writeFileSync(
      childConfig,
      `${readFileSync(childConfig, "utf-8").replace(
        'backend.command = "echo"',
        'backend.command = "node"',
      )}\nbackend.args = [${JSON.stringify(MOCK_BACKEND)}]\n`,
      "utf-8",
    );

    const result = runCli(
      ["run", "--chain", "normal-child", project, "mixed state roots"],
      { MOCK_FIXTURE_PATH: join(FIXTURES_DIR, "complete-success.json") },
      project,
    );
    expect(result.status, result.stderr).toBe(0);

    const chainsDir = join(project, PARENT_STATE_DIR_REL, "chains");
    const chainDir = readdirSync(chainsDir)
      .map((entry) => join(chainsDir, entry))
      .find((entry) => existsSync(join(entry, "step-1")));
    expect(chainDir).toBeDefined();
    const stepDir = join(chainDir ?? "", "step-1");
    expect(
      JSON.parse(readFileSync(join(stepDir, "state-layout.json"), "utf-8")),
    ).toEqual({ version: 1, state_dir: ".autoloop" });

    const records = readFileSync(
      join(stepDir, ".autoloop", "registry.jsonl"),
      "utf-8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as ChildRun);
    childRun = records.at(-1) as ChildRun;
  });

  afterAll(() => {
    cleanupTempProjects();
  });

  it("discovers the normal child through loops, control, health, and dashboard", async () => {
    const env = { AUTOLOOP_PROJECT_DIR: project };
    const loops = runCli(["loops", "--all", "--json"], env, project);
    expect(loops.status).toBe(0);
    expect(loops.stdout).toContain(childRun.run_id);

    const control = runCli(
      ["control", "show", childRun.run_id.slice(0, 8)],
      env,
      project,
    );
    expect(control.stdout + control.stderr).not.toContain("No run matching");
    expect(control.stdout).toContain(childRun.run_id);

    const health = runCli(["loops", "health"], env, project);
    expect(health.status).toBe(0);
    expect(health.stdout).toContain("1 completed in last 24h");

    const stateDir = join(project, PARENT_STATE_DIR_REL);
    const app = createApp({
      registryPath: join(stateDir, "registry.jsonl"),
      journalPath: join(stateDir, "journal.jsonl"),
      stateDir,
      stateDirRelativePath: PARENT_STATE_DIR_REL,
      bundleRoot: project,
      projectDir: project,
      selfCmd: "autoloop",
      listPresets: () => [],
    });
    const response = await app.request(`/api/runs/${childRun.run_id}`);
    expect(response.status).toBe(200);
    expect((await response.json()).run_id).toBe(childRun.run_id);
  });
});
