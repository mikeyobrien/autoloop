import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { jsonField } from "@mobrienv/autoloop-core";
import type { TrackerAdapter } from "./adapter.js";
import type { IssueSyncConfig } from "./config.js";
import {
  findByExternalId,
  findByTaskId,
  loadState,
  type SyncEntry,
  type SyncState,
  saveState,
  upsertEntry,
  withStateLock,
} from "./state.js";

export interface TaskLike {
  id: string;
  text: string;
  status: "open" | "done";
  source: string;
}

export interface TasksApi {
  listOpen(): TaskLike[];
  listDone(): TaskLike[];
  addTask(text: string, source: string): string;
}

export interface NoteContext {
  runId?: string;
  role?: string;
  branch?: string;
  summary?: string;
}

function sourceTag(tracker: string, externalId: string): string {
  return `${tracker}:${externalId}`;
}

export interface SyncedIssue {
  externalId: string;
  identifier?: string;
  title: string;
}
export interface TransitionedIssue extends SyncedIssue {
  to: string;
}
export interface PullResult {
  added: number;
  addedIssues: SyncedIssue[];
}
export interface PushResult {
  transitioned: number;
  created: number;
  promoted: number;
  transitionedIssues: TransitionedIssue[];
  createdIssues: SyncedIssue[];
  promotedIssues: TransitionedIssue[];
}
export interface ReleaseResult {
  promoted: number;
  promotedIssues: Array<{
    externalId: string;
    identifier?: string;
    branchName?: string;
  }>;
}

export async function pull(
  adapter: TrackerAdapter,
  config: IssueSyncConfig,
  tasksApi: TasksApi,
  stateFile: string,
): Promise<PullResult> {
  const tracker = config.tracker;
  const pullStates =
    config.linear?.pullStates ?? (config.github ? ["open"] : ["Todo"]);

  const issues = await adapter.listIssues(pullStates);

  return withStateLock(stateFile, () => {
    let state = loadState(stateFile);
    // Dedup against the CURRENT queue, not the persistent ledger: an issue that is
    // still in pull_states should be (re-)seeded into this run's queue unless it
    // already has an open task here. The tracker is the source of truth — this is
    // what keeps issues from silently falling out across runs.
    const openSources = new Set(tasksApi.listOpen().map((t) => t.source));
    const addedIssues: SyncedIssue[] = [];
    for (const issue of issues) {
      const source = sourceTag(tracker, issue.id);
      let taskId = findByExternalId(state, tracker, issue.id)?.taskId;
      if (!openSources.has(source)) {
        taskId = tasksApi.addTask(issue.title, source);
        addedIssues.push({
          externalId: issue.id,
          identifier: issue.identifier,
          title: issue.title,
        });
      }
      state = upsertEntry(state, {
        taskId: taskId ?? "",
        tracker,
        externalId: issue.id,
        lastSyncedStatus: issue.status,
        branchName: issue.branchName,
        identifier: issue.identifier,
        title: issue.title,
      });
    }
    saveState(stateFile, state);
    return { added: addedIssues.length, addedIssues };
  });
}

export async function push(
  adapter: TrackerAdapter,
  config: IssueSyncConfig,
  tasksApi: TasksApi,
  stateFile: string,
  noteCtx?: NoteContext,
  opts?: {
    release?: boolean;
    archive?: boolean;
  },
): Promise<PushResult> {
  const tracker = config.tracker;
  const reviewState = config.linear?.reviewState ?? "merged";
  const doneState = config.linear?.doneState ?? "Done";

  return withStateLock(stateFile, async () => {
    let state = loadState(stateFile);
    const transitionedIssues: TransitionedIssue[] = [];
    const createdIssues: SyncedIssue[] = [];

    // 1. Completed tasks → In Review. The signal is task STATUS (status:done in the
    // run's tasks.jsonl), not git commits — the agent must `autoloop task complete`
    // each finished issue, which the completion gate enforces before the run ends.
    // Unmapped done tasks (local-origin work) get a tracker issue created.
    for (const task of tasksApi.listDone()) {
      const mapped = findByTaskId(state, task.id);
      try {
        if (mapped) {
          if (mapped.lastSyncedStatus === reviewState) continue;
          await adapter.transitionIssue(mapped.externalId, reviewState);
          if (noteCtx) {
            await adapter.commentIssue(
              mapped.externalId,
              buildNoteBody(noteCtx, task),
            );
          }
          state = upsertEntry(state, {
            ...mapped,
            lastSyncedStatus: reviewState,
          });
          transitionedIssues.push({
            externalId: mapped.externalId,
            identifier: mapped.identifier,
            title: task.text,
            to: reviewState,
          });
        } else {
          const issue = await adapter.createIssue({
            title: task.text,
            description: noteCtx ? buildNoteBody(noteCtx, task) : undefined,
            labels: resolveCreateLabels(config),
          });
          state = upsertEntry(state, {
            taskId: task.id,
            tracker,
            externalId: issue.id,
            lastSyncedStatus: issue.status,
            identifier: issue.identifier,
            title: task.text,
            branchName: issue.branchName,
          });
          createdIssues.push({
            externalId: issue.id,
            identifier: issue.identifier,
            title: task.text,
          });
        }
      } catch {
        // Leave this issue un-synced; it retries next run. Persist the rest.
      }
    }

    // 2. Optional release (`push --release`): promote everything now In Review to Done.
    // Lets whole-queue, main-branch development close out committed work without a
    // separate versioned `release` step.
    const promotedIssues: TransitionedIssue[] = [];
    if (opts?.release) {
      const promote = await promoteReviewToDone(
        adapter,
        state,
        reviewState,
        doneState,
        (entry) =>
          noteCtx
            ? buildNoteBody(noteCtx, {
                id: entry.taskId,
                text: entry.title ?? entry.identifier ?? entry.externalId,
                status: "done",
                source: sourceTag(tracker, entry.externalId),
              })
            : undefined,
        opts.archive !== false,
      );
      state = promote.state;
      for (const entry of promote.promoted) {
        promotedIssues.push({
          externalId: entry.externalId,
          identifier: entry.identifier,
          title: entry.title ?? "",
          to: doneState,
        });
      }
    }

    saveState(stateFile, state);
    return {
      transitioned: transitionedIssues.length,
      created: createdIssues.length,
      promoted: promotedIssues.length,
      transitionedIssues,
      createdIssues,
      promotedIssues,
    };
  });
}

/**
 * Transition every entry currently in `reviewState` to `doneState`, commenting and
 * (optionally) archiving each. A failed transition is skipped and retried later;
 * the rest still persist. Shared by `push --release` and the versioned `release`.
 */
async function promoteReviewToDone(
  adapter: TrackerAdapter,
  initialState: SyncState,
  reviewState: string,
  doneState: string,
  makeComment: (entry: SyncEntry) => string | undefined,
  archive: boolean,
): Promise<{ state: SyncState; promoted: SyncEntry[] }> {
  let state = initialState;
  const promoted: SyncEntry[] = [];
  for (const entry of state.entries) {
    if (entry.lastSyncedStatus !== reviewState) continue;
    try {
      await adapter.transitionIssue(entry.externalId, doneState);
      const body = makeComment(entry);
      if (body) await adapter.commentIssue(entry.externalId, body);
      if (archive && adapter.archiveIssue) {
        await adapter.archiveIssue(entry.externalId);
      }
      state = upsertEntry(state, { ...entry, lastSyncedStatus: doneState });
      promoted.push(entry);
    } catch {
      // Leave un-promoted; retried on the next release. Persist the rest.
    }
  }
  return { state, promoted };
}

export async function release(
  adapter: TrackerAdapter,
  config: IssueSyncConfig,
  stateFile: string,
  version: string,
  repoLabel?: string,
  noteCtx?: NoteContext,
  opts?: { archive?: boolean },
): Promise<ReleaseResult> {
  const reviewState = config.linear?.reviewState ?? "merged";
  const doneState = config.linear?.doneState ?? "Done";
  const archive = opts?.archive !== false;

  return withStateLock(stateFile, async () => {
    const { state, promoted } = await promoteReviewToDone(
      adapter,
      loadState(stateFile),
      reviewState,
      doneState,
      () => buildReleaseComment(version, repoLabel, noteCtx),
      archive,
    );
    saveState(stateFile, state);
    return {
      promoted: promoted.length,
      promotedIssues: promoted.map((entry) => ({
        externalId: entry.externalId,
        identifier: entry.identifier,
        branchName: entry.branchName,
      })),
    };
  });
}

/**
 * A TasksApi backed by autoloop's append-only `.autoloop/tasks.jsonl`. Shared by the
 * tracker CLIs so the format/ID logic lives in one place.
 */
export function createJsonlTasksApi(tasksFile: string): TasksApi {
  function readEntries(): TaskLike[] {
    if (!existsSync(tasksFile)) return [];
    const byId = new Map<string, TaskLike>();
    for (const line of readFileSync(tasksFile, "utf-8").split("\n")) {
      if (!line) continue;
      try {
        const o = JSON.parse(line) as {
          id: string;
          type: string;
          text?: string;
          status?: string;
          source?: string;
          target_id?: string;
        };
        if (o.type === "task") {
          byId.set(o.id, {
            id: o.id,
            text: o.text ?? "",
            status: o.status === "done" ? "done" : "open",
            source: o.source ?? "manual",
          });
        } else if (o.type === "task-tombstone" && o.target_id) {
          byId.delete(o.target_id);
        }
      } catch {
        /* skip malformed lines */
      }
    }
    return [...byId.values()];
  }

  return {
    listOpen: () => readEntries().filter((t) => t.status === "open"),
    listDone: () => readEntries().filter((t) => t.status === "done"),
    addTask: (text, source) => {
      const entries = readEntries();
      // max(existing N)+1, not count+1 — avoids colliding with reused ids.
      const maxN = entries.reduce((m, t) => {
        const match = /^task-(\d+)$/.exec(t.id);
        return match ? Math.max(m, Number(match[1])) : m;
      }, 0);
      const id = `task-${maxN + 1}`;
      mkdirSync(dirname(tasksFile), { recursive: true });
      // Write the SAME serialization autoloop's core task reader expects
      // (`jsonField` → `"key": value` with the core's escaping). A bare
      // JSON.stringify (compact `"key":value`) is NOT parsed by the core
      // materializer, so pulled tasks would be invisible to the prompt and the
      // completion gate. Keep this byte-compatible with core `taskLine`.
      const line = `{${jsonField("id", id)}, ${jsonField("type", "task")}, ${jsonField(
        "text",
        text,
      )}, ${jsonField("status", "open")}, ${jsonField("source", source)}, ${jsonField(
        "created",
        new Date().toISOString(),
      )}}\n`;
      appendFileSync(tasksFile, line, "utf-8");
      return id;
    },
  };
}

function resolveCreateLabels(config: IssueSyncConfig): string[] {
  if (config.tracker === "github" && config.github?.queuedLabel) {
    return [config.github.queuedLabel, "source:autoloop"];
  }
  return [];
}

function buildNoteBody(ctx: NoteContext, task: TaskLike): string {
  const lines: string[] = [];
  if (ctx.runId) lines.push(`**Run:** ${ctx.runId}`);
  if (ctx.role) lines.push(`**Role:** ${ctx.role}`);
  if (ctx.branch) lines.push(`**Branch:** ${ctx.branch}`);
  lines.push(`**Task:** ${task.text}`);
  if (ctx.summary) lines.push(`**Summary:** ${ctx.summary}`);
  return lines.join("\n");
}

function buildReleaseComment(
  version: string,
  repoLabel?: string,
  ctx?: NoteContext,
): string {
  const parts = [`Released in **${version}**`];
  if (repoLabel) parts.push(`(${repoLabel})`);
  if (ctx?.runId) parts.push(`— autoloop run: ${ctx.runId}`);
  return parts.join(" ");
}
