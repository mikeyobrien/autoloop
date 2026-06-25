import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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

describe("integration: [hooks] lifecycle", () => {
  it("fires pre_run and post_run hooks and captures output to journal", () => {
    const project = makeTempProject("hooks-run");
    const sentinelPre = join(project, "pre_run.sentinel");
    const sentinelPost = join(project, "post_run.sentinel");

    const hooksPre = `touch ${sentinelPre}`;
    const hooksPost = `touch ${sentinelPost}`;

    const configPath = join(project, "autoloops.toml");
    const existing = readFileSync(configPath, "utf-8");
    writeFileSync(
      configPath,
      `${existing}\n[hooks]\npre_run = ${JSON.stringify(hooksPre)}\npost_run = ${JSON.stringify(hooksPost)}\n`,
      "utf-8",
    );

    const fixture = join(FIXTURES_DIR, "complete-success.json");
    const res = runCli(["run", project, "test hooks"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).toBe(0);
    expect(existsSync(sentinelPre)).toBe(true);
    expect(existsSync(sentinelPost)).toBe(true);

    const journal = readFileSync(
      join(project, ".autoloop/journal.jsonl"),
      "utf-8",
    );
    expect(journal).toContain('"topic": "hook.output"');
    expect(journal).toContain('"hook": "pre_run"');
    expect(journal).toContain('"hook": "post_run"');
  });

  it("prints a hook output block to the screen", () => {
    const project = makeTempProject("hooks-block");
    const hookCmd = `echo "synced 3 issues: SAU-1 SAU-2 SAU-3"`;

    const configPath = join(project, "autoloops.toml");
    const existing = readFileSync(configPath, "utf-8");
    writeFileSync(
      configPath,
      `${existing}\n[hooks]\npre_run = ${JSON.stringify(hookCmd)}\n`,
      "utf-8",
    );

    const fixture = join(FIXTURES_DIR, "complete-success.json");
    const res = runCli(["run", project, "test hook block"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("── hook: pre_run");
    expect(res.stdout).toContain("synced 3 issues: SAU-1 SAU-2 SAU-3");
  });

  it("fires pre_iteration and post_iteration hooks with iteration env var", () => {
    const project = makeTempProject("hooks-iter");
    const iterDir = join(project, "iter-hooks");

    const hooksPre = `mkdir -p ${iterDir} && echo "$AUTOLOOP_ITERATION" > ${iterDir}/pre_$AUTOLOOP_ITERATION`;
    const hooksPost = `mkdir -p ${iterDir} && echo "$AUTOLOOP_ITERATION" > ${iterDir}/post_$AUTOLOOP_ITERATION`;

    const configPath = join(project, "autoloops.toml");
    const existing = readFileSync(configPath, "utf-8");
    writeFileSync(
      configPath,
      `${existing}\n[hooks]\npre_iteration = ${JSON.stringify(hooksPre)}\npost_iteration = ${JSON.stringify(hooksPost)}\n`,
      "utf-8",
    );

    const fixture = join(FIXTURES_DIR, "complete-success.json");
    const res = runCli(["run", project, "test iteration hooks"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).toBe(0);
    expect(existsSync(join(iterDir, "pre_1"))).toBe(true);
    expect(existsSync(join(iterDir, "post_1"))).toBe(true);

    const journal = readFileSync(
      join(project, ".autoloop/journal.jsonl"),
      "utf-8",
    );
    expect(journal).toContain('"hook": "pre_iteration"');
    expect(journal).toContain('"hook": "post_iteration"');
  });

  it("passes AUTOLOOP_PROJECT_DIR, AUTOLOOP_RUN_ID, AUTOLOOP_TASKS_FILE env vars", () => {
    const project = makeTempProject("hooks-env");
    const envFile = join(project, "hook-env.txt");

    const hookCmd = `echo "dir=$AUTOLOOP_PROJECT_DIR run=$AUTOLOOP_RUN_ID tasks=$AUTOLOOP_TASKS_FILE" > ${envFile}`;

    const configPath = join(project, "autoloops.toml");
    const existing = readFileSync(configPath, "utf-8");
    writeFileSync(
      configPath,
      `${existing}\n[hooks]\npre_run = ${JSON.stringify(hookCmd)}\n`,
      "utf-8",
    );

    const fixture = join(FIXTURES_DIR, "complete-success.json");
    const res = runCli(["run", project, "test env vars"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).toBe(0);
    expect(existsSync(envFile)).toBe(true);
    const content = readFileSync(envFile, "utf-8");
    // AUTOLOOP_PROJECT_DIR is the work dir, realpath-resolved (macOS /tmp -> /private/var).
    expect(content).toContain(`dir=${realpathSync(project)}`);
    expect(content).toMatch(/run=\S+/);
    expect(content).toContain("tasks=");
  });

  it("non-fatal hook failure: run continues when hook exits non-zero", () => {
    const project = makeTempProject("hooks-nonfatal");
    const sentinelAfter = join(project, "after.sentinel");

    const hookCmd = "exit 1";
    const postRun = `touch ${sentinelAfter}`;

    const configPath = join(project, "autoloops.toml");
    const existing = readFileSync(configPath, "utf-8");
    writeFileSync(
      configPath,
      `${existing}\n[hooks]\npre_run = ${JSON.stringify(hookCmd)}\npost_run = ${JSON.stringify(postRun)}\n`,
      "utf-8",
    );

    const fixture = join(FIXTURES_DIR, "complete-success.json");
    const res = runCli(["run", project, "test non-fatal hook failure"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    // Run should succeed despite hook failure (non-fatal by default)
    expect(res.status).toBe(0);
    // post_run should still fire
    expect(existsSync(sentinelAfter)).toBe(true);
  });

  it("strict mode: pre_run failure aborts the run", () => {
    const project = makeTempProject("hooks-strict");

    const hookCmd = "exit 1";

    const configPath = join(project, "autoloops.toml");
    const existing = readFileSync(configPath, "utf-8");
    writeFileSync(
      configPath,
      `${existing}\n[hooks]\npre_run = ${JSON.stringify(hookCmd)}\nstrict = true\n`,
      "utf-8",
    );

    const fixture = join(FIXTURES_DIR, "complete-success.json");
    const res = runCli(["run", project, "test strict pre_run failure"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).not.toBe(0);
  });
});
