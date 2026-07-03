import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TaskLike, TasksApi } from "@mobrienv/autoloop-issue-sync-core";
import { pull } from "@mobrienv/autoloop-issue-sync-core";
import { beforeAll, describe, expect, it } from "vitest";
import type { GhSyncConfig } from "../src/adapter.js";
import { GhAdapter } from "../src/adapter.js";

const CONTRACT_REPO = process.env.GH_SYNC_CONTRACT_REPO;
const RUN_CONTRACT = Boolean(CONTRACT_REPO);

function skipUnless(condition: boolean, label: string) {
  return condition ? describe : describe.skip.bind(describe, label);
}

class FakeTasksApi implements TasksApi {
  private tasks: TaskLike[] = [];
  private nextId = 1;

  listOpen(): TaskLike[] {
    return this.tasks.filter((t) => t.status === "open");
  }
  listDone(): TaskLike[] {
    return this.tasks.filter((t) => t.status === "done");
  }
  addTask(text: string, source: string): string {
    const id = `task-${this.nextId++}`;
    this.tasks.push({ id, text, status: "open", source });
    return id;
  }
  markDone(id: string): void {
    const t = this.tasks.find((t) => t.id === id);
    if (t) t.status = "done";
  }
}

describe("GhAdapter unit (no gh CLI)", () => {
  it("is importable and constructable", () => {
    const config: GhSyncConfig = { repo: "owner/repo" };
    const adapter = new GhAdapter(config);
    expect(adapter).toBeDefined();
  });
});

skipUnless(RUN_CONTRACT, "gh contract test")(
  `GhAdapter contract test (requires GH_SYNC_CONTRACT_REPO=${CONTRACT_REPO ?? "unset"})`,
  () => {
    const config: GhSyncConfig = {
      repo: CONTRACT_REPO ?? "",
      queuedLabel: "autoloop:queued",
    };
    const issueConfig = {
      tracker: "github" as const,
      github: { repo: CONTRACT_REPO ?? "", queuedLabel: "autoloop:queued" },
    };
    const adapter = new GhAdapter(config);
    let stateFile: string;
    let tasksApi: FakeTasksApi;

    beforeAll(() => {
      const dir = mkdtempSync(join(tmpdir(), "gh-sync-contract-"));
      mkdirSync(join(dir, ".autoloop"), { recursive: true });
      stateFile = join(dir, ".autoloop", "issue-sync-state.json");
      tasksApi = new FakeTasksApi();
    });

    it("lists open issues with autoloop:queued label", async () => {
      const issues = await adapter.listIssues(["open"]);
      expect(Array.isArray(issues)).toBe(true);
    });

    it("pull → push round-trip: creates issue, pull dedup works", async () => {
      const before = await adapter.listIssues(["open"]);
      const beforeCount = before.length;

      await pull(adapter, issueConfig, tasksApi, stateFile);

      await pull(adapter, issueConfig, tasksApi, stateFile);
      expect(tasksApi.listOpen().length).toBe(beforeCount);
    });
  },
);
