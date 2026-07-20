import { buildHookEnv } from "@mobrienv/autoloop-harness/hooks";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { describe, expect, it } from "vitest";

describe("buildHookEnv", () => {
  it("exports run-scoped state, shared state, and exact task storage", () => {
    const loop = {
      paths: {
        workDir: "/repo/worktree",
        stateDir: "/repo/worktree/.ralph/autoloop",
        baseStateDir: "/repo/.ralph/autoloop",
        tasksFile: "/repo/worktree/.queue/tasks.jsonl",
      },
      runtime: { runId: "run-1" },
      launch: { preset: "autocode" },
    } as LoopContext;

    expect(buildHookEnv(loop)).toMatchObject({
      AUTOLOOP_PROJECT_DIR: "/repo/worktree",
      AUTOLOOP_RUN_ID: "run-1",
      AUTOLOOP_PRESET: "autocode",
      AUTOLOOP_STATE_DIR: "/repo/worktree/.ralph/autoloop",
      AUTOLOOP_BASE_STATE_DIR: "/repo/.ralph/autoloop",
      AUTOLOOP_TASKS_FILE: "/repo/worktree/.queue/tasks.jsonl",
    });
  });
});
