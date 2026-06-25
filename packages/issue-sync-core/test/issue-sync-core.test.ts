import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeOpenFrom } from "@mobrienv/autoloop-core/tasks";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  CreateIssueInput,
  Issue,
  TrackerAdapter,
} from "../src/adapter.js";
import type { IssueSyncConfig } from "../src/config.js";
import type { TaskLike, TasksApi } from "../src/operations.js";
import { createJsonlTasksApi, pull, push, release } from "../src/operations.js";
import { loadState } from "../src/state.js";

class FakeAdapter implements TrackerAdapter {
  issues: Map<string, Issue> = new Map();
  transitions: Array<{ id: string; state: string }> = [];
  comments: Array<{ id: string; body: string }> = [];
  archived: string[] = [];
  failTransitions: Set<string> = new Set();
  nextId = 1;

  async listIssues(states: string[]): Promise<Issue[]> {
    return [...this.issues.values()].filter((i) => states.includes(i.status));
  }

  async createIssue(input: CreateIssueInput): Promise<Issue> {
    const id = `issue-${this.nextId++}`;
    const issue: Issue = { id, title: input.title, status: "Todo" };
    this.issues.set(id, issue);
    return issue;
  }

  async transitionIssue(id: string, targetState: string): Promise<void> {
    if (this.failTransitions.has(id)) throw new Error(`boom: ${id}`);
    this.transitions.push({ id, state: targetState });
    const issue = this.issues.get(id);
    if (issue) issue.status = targetState;
  }

  async commentIssue(id: string, body: string): Promise<void> {
    this.comments.push({ id, body });
  }

  async archiveIssue(id: string): Promise<void> {
    this.archived.push(id);
  }

  seed(
    id: string,
    title: string,
    status: string,
    branchName?: string,
    identifier?: string,
  ): void {
    this.issues.set(id, { id, title, status, branchName, identifier });
  }
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

function makeStateFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "issue-sync-test-"));
  mkdirSync(join(dir, ".autoloop"), { recursive: true });
  return join(dir, ".autoloop", "issue-sync-state.json");
}

const linearConfig: IssueSyncConfig = {
  tracker: "linear",
  linear: { pullStates: ["Todo"], reviewState: "In Review", doneState: "Done" },
};

describe("createJsonlTasksApi ↔ core task reader", () => {
  // Regression: tasks written by the sync queue MUST be parseable by autoloop's
  // core materializer (used by the prompt projection and the completion gate).
  // A compact JSON.stringify line is invisible to the core reader, which let runs
  // complete with pulled issues still open and synced nothing. The line must use
  // the core `jsonField` serialization.
  it("writes lines the core materializer sees as open tasks", () => {
    const dir = mkdtempSync(join(tmpdir(), "issue-sync-fmt-"));
    const tasksFile = join(dir, ".autoloop", "runs", "r1", "tasks.jsonl");
    const api = createJsonlTasksApi(tasksFile);
    api.addTask("[P0] de-dupe eyebrow/quote", "linear:abc-123");

    const open = materializeOpenFrom(tasksFile);
    expect(open).toHaveLength(1);
    expect(open[0].status).toBe("open");
    expect(open[0].source).toBe("linear:abc-123");
    expect(open[0].text).toBe("[P0] de-dupe eyebrow/quote");
  });

  it("round-trips text containing quotes and newlines", () => {
    const dir = mkdtempSync(join(tmpdir(), "issue-sync-fmt-"));
    const tasksFile = join(dir, "tasks.jsonl");
    const api = createJsonlTasksApi(tasksFile);
    const tricky = 'fix "quoted" thing\nwith a newline';
    api.addTask(tricky, "linear:xyz");

    const open = materializeOpenFrom(tasksFile);
    expect(open).toHaveLength(1);
    expect(open[0].text).toBe(tricky);
    // And the sync queue still reads its own writes.
    expect(api.listOpen()).toHaveLength(1);
  });
});

describe("pull", () => {
  let adapter: FakeAdapter;
  let tasksApi: FakeTasksApi;
  let stateFile: string;

  beforeEach(() => {
    adapter = new FakeAdapter();
    tasksApi = new FakeTasksApi();
    stateFile = makeStateFile();
  });

  it("adds new issues as tasks", async () => {
    adapter.seed("i1", "Fix bug A", "Todo");
    const result = await pull(adapter, linearConfig, tasksApi, stateFile);
    expect(result.added).toBe(1);
    expect(tasksApi.listOpen()).toHaveLength(1);
    expect(tasksApi.listOpen()[0].text).toBe("Fix bug A");
  });

  it("sets source tag on pulled tasks", async () => {
    adapter.seed("i1", "Fix bug A", "Todo");
    await pull(adapter, linearConfig, tasksApi, stateFile);
    expect(tasksApi.listOpen()[0].source).toBe("linear:i1");
  });

  it("deduplicates: same issue not pulled twice", async () => {
    adapter.seed("i1", "Fix bug A", "Todo");
    await pull(adapter, linearConfig, tasksApi, stateFile);
    await pull(adapter, linearConfig, tasksApi, stateFile);
    expect(tasksApi.listOpen()).toHaveLength(1);
  });

  it("persists mapping to state file", async () => {
    adapter.seed("i1", "Fix bug A", "Todo");
    await pull(adapter, linearConfig, tasksApi, stateFile);
    const state = loadState(stateFile);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].externalId).toBe("i1");
    expect(state.entries[0].tracker).toBe("linear");
  });

  it("skips issues not in pull states", async () => {
    adapter.seed("i1", "Done issue", "Done");
    const result = await pull(adapter, linearConfig, tasksApi, stateFile);
    expect(result.added).toBe(0);
  });

  it("re-seeds an open issue that fell out of the queue (new run)", async () => {
    adapter.seed("i1", "Fix bug A", "Todo");
    await pull(adapter, linearConfig, tasksApi, stateFile);
    expect(tasksApi.listOpen()).toHaveLength(1);

    // A new run: fresh (empty) task queue, same persistent state file. The issue is
    // already in the ledger but NOT in this queue, so it must be re-seeded.
    const freshQueue = new FakeTasksApi();
    const result = await pull(adapter, linearConfig, freshQueue, stateFile);
    expect(result.added).toBe(1);
    expect(freshQueue.listOpen()).toHaveLength(1);
  });

  it("does not double-add an issue already open in the queue", async () => {
    adapter.seed("i1", "Fix bug A", "Todo");
    await pull(adapter, linearConfig, tasksApi, stateFile);
    const result = await pull(adapter, linearConfig, tasksApi, stateFile);
    expect(result.added).toBe(0);
    expect(tasksApi.listOpen()).toHaveLength(1);
  });
});

describe("push", () => {
  let adapter: FakeAdapter;
  let tasksApi: FakeTasksApi;
  let stateFile: string;

  beforeEach(() => {
    adapter = new FakeAdapter();
    tasksApi = new FakeTasksApi();
    stateFile = makeStateFile();
  });

  it("transitions mapped issue to In Review on task completion", async () => {
    adapter.seed("i1", "Fix bug A", "Todo");
    await pull(adapter, linearConfig, tasksApi, stateFile);
    const taskId = tasksApi.listOpen()[0].id;
    tasksApi.markDone(taskId);

    await push(adapter, linearConfig, tasksApi, stateFile);
    expect(adapter.transitions).toContainEqual({
      id: "i1",
      state: "In Review",
    });
  });

  it("creates a tracker issue for unmapped done tasks", async () => {
    tasksApi.addTask("autoqa finding: missing null check", "autoqa");
    tasksApi.markDone("task-1");

    const result = await push(adapter, linearConfig, tasksApi, stateFile);
    expect(result.created).toBe(1);
    expect(adapter.issues.size).toBe(1);
  });

  it("records new mapping for created issues", async () => {
    tasksApi.addTask("autoqa finding: missing null check", "autoqa");
    tasksApi.markDone("task-1");

    await push(adapter, linearConfig, tasksApi, stateFile);
    const state = loadState(stateFile);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].taskId).toBe("task-1");
  });

  it("idempotent: does not re-transition already-reviewed issues", async () => {
    adapter.seed("i1", "Fix bug A", "Todo");
    await pull(adapter, linearConfig, tasksApi, stateFile);
    const taskId = tasksApi.listOpen()[0].id;
    tasksApi.markDone(taskId);

    await push(adapter, linearConfig, tasksApi, stateFile);
    await push(adapter, linearConfig, tasksApi, stateFile);
    const reviewTransitions = adapter.transitions.filter(
      (t) => t.state === "In Review",
    );
    expect(reviewTransitions).toHaveLength(1);
  });

  it("posts a comment with note context when provided", async () => {
    adapter.seed("i1", "Fix bug A", "Todo");
    await pull(adapter, linearConfig, tasksApi, stateFile);
    tasksApi.markDone(tasksApi.listOpen()[0].id);

    await push(adapter, linearConfig, tasksApi, stateFile, {
      runId: "run-123",
      branch: "feat/bug-a",
    });
    expect(adapter.comments).toHaveLength(1);
    expect(adapter.comments[0].body).toContain("run-123");
  });

  it("does not transition issues whose task is not done", async () => {
    adapter.seed("i1", "Fix bug A", "Todo");
    await pull(adapter, linearConfig, tasksApi, stateFile);
    // Task left open — task STATUS is the only signal; nothing should move.
    await push(adapter, linearConfig, tasksApi, stateFile);
    expect(adapter.transitions).toHaveLength(0);
  });

  it("--release promotes In Review issues to Done in the same push", async () => {
    adapter.seed("i1", "Fix bug A", "Todo");
    await pull(adapter, linearConfig, tasksApi, stateFile);
    tasksApi.markDone(tasksApi.listOpen()[0].id);

    const result = await push(
      adapter,
      linearConfig,
      tasksApi,
      stateFile,
      undefined,
      { release: true },
    );
    expect(result.transitioned).toBe(1);
    expect(result.promoted).toBe(1);
    expect(adapter.transitions).toContainEqual({
      id: "i1",
      state: "In Review",
    });
    expect(adapter.transitions).toContainEqual({ id: "i1", state: "Done" });
    expect(adapter.archived).toContain("i1");
  });

  it("--release --no-archive promotes to Done without archiving", async () => {
    adapter.seed("i1", "Fix bug A", "Todo");
    await pull(adapter, linearConfig, tasksApi, stateFile);
    tasksApi.markDone(tasksApi.listOpen()[0].id);

    await push(adapter, linearConfig, tasksApi, stateFile, undefined, {
      release: true,
      archive: false,
    });
    expect(adapter.transitions).toContainEqual({ id: "i1", state: "Done" });
    expect(adapter.archived).not.toContain("i1");
  });

  it("without --release, push leaves issues in In Review", async () => {
    adapter.seed("i1", "Fix bug A", "Todo");
    await pull(adapter, linearConfig, tasksApi, stateFile);
    tasksApi.markDone(tasksApi.listOpen()[0].id);

    const result = await push(adapter, linearConfig, tasksApi, stateFile);
    expect(result.promoted).toBe(0);
    expect(adapter.transitions).not.toContainEqual({ id: "i1", state: "Done" });
  });

  it("a failing transition doesn't block others; successes persist", async () => {
    adapter.seed("i1", "A", "Todo");
    adapter.seed("i2", "B", "Todo");
    await pull(adapter, linearConfig, tasksApi, stateFile);
    for (const t of tasksApi.listOpen()) tasksApi.markDone(t.id);
    adapter.failTransitions.add("i1");

    const result = await push(adapter, linearConfig, tasksApi, stateFile);
    expect(result.transitioned).toBe(1);
    expect(adapter.transitions).toContainEqual({
      id: "i2",
      state: "In Review",
    });

    const state = loadState(stateFile);
    expect(
      state.entries.find((e) => e.externalId === "i2")?.lastSyncedStatus,
    ).toBe("In Review");
    expect(
      state.entries.find((e) => e.externalId === "i1")?.lastSyncedStatus,
    ).toBe("Todo");
  });
});

describe("release", () => {
  let adapter: FakeAdapter;
  let tasksApi: FakeTasksApi;
  let stateFile: string;

  beforeEach(() => {
    adapter = new FakeAdapter();
    tasksApi = new FakeTasksApi();
    stateFile = makeStateFile();
  });

  it("promotes In Review issues to Done", async () => {
    adapter.seed("i1", "Fix bug A", "Todo");
    await pull(adapter, linearConfig, tasksApi, stateFile);
    tasksApi.markDone(tasksApi.listOpen()[0].id);
    await push(adapter, linearConfig, tasksApi, stateFile);

    const result = await release(adapter, linearConfig, stateFile, "v1.0.0");
    expect(result.promoted).toBe(1);
    expect(adapter.transitions).toContainEqual({ id: "i1", state: "Done" });
  });

  it("archives promoted issues and returns their branch", async () => {
    adapter.seed("i1", "Fix bug A", "Todo", "feat/bug-a");
    await pull(adapter, linearConfig, tasksApi, stateFile);
    tasksApi.markDone(tasksApi.listOpen()[0].id);
    await push(adapter, linearConfig, tasksApi, stateFile);

    const result = await release(adapter, linearConfig, stateFile, "v1.0.0");
    expect(adapter.archived).toContain("i1");
    expect(result.promotedIssues[0].branchName).toBe("feat/bug-a");
  });

  it("posts a version comment on release", async () => {
    adapter.seed("i1", "Fix bug A", "Todo");
    await pull(adapter, linearConfig, tasksApi, stateFile);
    tasksApi.markDone(tasksApi.listOpen()[0].id);
    await push(adapter, linearConfig, tasksApi, stateFile);
    await release(adapter, linearConfig, stateFile, "v1.0.0");

    const releaseComment = adapter.comments.find((c) =>
      c.body.includes("v1.0.0"),
    );
    expect(releaseComment).toBeDefined();
  });

  it("idempotent: does not promote already-Done issues", async () => {
    adapter.seed("i1", "Fix bug A", "Todo");
    await pull(adapter, linearConfig, tasksApi, stateFile);
    tasksApi.markDone(tasksApi.listOpen()[0].id);
    await push(adapter, linearConfig, tasksApi, stateFile);
    await release(adapter, linearConfig, stateFile, "v1.0.0");
    await release(adapter, linearConfig, stateFile, "v1.0.0");

    const doneTransitions = adapter.transitions.filter(
      (t) => t.state === "Done",
    );
    expect(doneTransitions).toHaveLength(1);
  });

  it("skips issues not in review state", async () => {
    adapter.seed("i1", "Fix bug A", "Todo");
    await pull(adapter, linearConfig, tasksApi, stateFile);

    const result = await release(adapter, linearConfig, stateFile, "v1.0.0");
    expect(result.promoted).toBe(0);
  });
});
