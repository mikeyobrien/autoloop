import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as config from "../config.js";
import { jsonField } from "../json.js";
import type { TaskEntry } from "../tasks.js";
import { materializeOpenFrom } from "../tasks.js";
import * as topology from "../topology.js";
import { joinCsv, listText, splitCsv } from "../utils.js";
import {
  appendAgentEvent,
  appendEvent,
  latestIterationForRun,
  latestRunId,
} from "./journal.js";

const COORDINATION_TOPICS = new Set([
  "issue.discovered",
  "issue.resolved",
  "slice.started",
  "slice.verified",
  "slice.committed",
  "context.archived",
  "chain.spawn",
]);

export function coordinationTopic(topic: string): boolean {
  return COORDINATION_TOPICS.has(topic);
}

const CORE_SYSTEM_TOPICS = new Set([
  "iteration.start",
  "iteration.finish",
  "loop.start",
  "loop.complete",
  "loop.stop",
  "review.start",
  "review.finish",
  "backend.start",
  "backend.finish",
  "event.invalid",
]);

export function coreSystemTopic(topic: string): boolean {
  if (CORE_SYSTEM_TOPICS.has(topic)) return true;
  return topic.startsWith("wave.");
}

export function systemTopic(topic: string): boolean {
  return coordinationTopic(topic) || coreSystemTopic(topic);
}

export function parallelTopic(topic: string): boolean {
  return parallelTriggerTopic(topic) || reservedParallelJoinedTopic(topic);
}

export function parallelTriggerTopic(topic: string): boolean {
  if (topic === "explore.parallel") return true;
  return dispatchParallelTopic(topic);
}

function dispatchParallelTopic(topic: string): boolean {
  if (topic === "explore.parallel") return false;
  return topic.endsWith(".parallel");
}

export function reservedParallelJoinedTopic(topic: string): boolean {
  return topic.endsWith(".parallel.joined");
}

export function emit(projectDir: string, topic: string, payload: string): void {
  const journalFile = resolveEmitJournalFile(projectDir);
  mkdirSync(dirname(journalFile), { recursive: true });
  const validation = emitValidationContext(projectDir, journalFile);

  if (coordinationTopic(topic)) {
    acceptEmit(journalFile, topic, payload, validation);
    return;
  }

  // Task completion gate: block completion if open tasks remain
  if (topic === validation.completionEvent) {
    const tasksFile = config.resolveTasksFile(projectDir);
    const openTasks = materializeOpenFrom(tasksFile);
    if (openTasks.length > 0) {
      rejectTaskGate(journalFile, topic, openTasks, validation);
      return;
    }
  }

  if (
    invalidEvent(
      topic,
      validation.allowedEvents,
      validation.parallelEnabled,
      validation.completionEvent,
    )
  ) {
    rejectEmit(journalFile, topic, validation);
  } else {
    acceptEmit(journalFile, topic, payload, validation);
  }
}

export function invalidEvent(
  emittedTopic: string,
  allowedEvents: string[],
  parallelEnabled: boolean,
  completionEvent: string,
): boolean {
  if (!emittedTopic) return false;
  if (reservedParallelJoinedTopic(emittedTopic)) return true;

  if (!parallelEnabled) {
    if (parallelTopic(emittedTopic)) return true;
    return invalidEventAfterParallelCheck(emittedTopic, allowedEvents);
  }

  if (parallelTopic(emittedTopic)) {
    return !validParallelTriggerEvent(
      emittedTopic,
      allowedEvents,
      completionEvent,
    );
  }

  return invalidEventAfterParallelCheck(emittedTopic, allowedEvents);
}

function invalidEventAfterParallelCheck(
  emittedTopic: string,
  allowedEvents: string[],
): boolean {
  if (allowedEvents.length === 0) return false;
  return !topology.eventMatchesAny(emittedTopic, allowedEvents);
}

function validParallelTriggerEvent(
  emittedTopic: string,
  allowedEvents: string[],
  completionEvent: string,
): boolean {
  if (emittedTopic === "explore.parallel") return true;
  const baseEvent = parallelDispatchBase(emittedTopic);
  if (!baseEvent) return false;
  if (baseEvent === completionEvent) return false;
  if (
    coordinationTopic(baseEvent) ||
    coreSystemTopic(baseEvent) ||
    parallelTopic(baseEvent)
  )
    return false;
  if (allowedEvents.length === 0) return false;
  return topology.eventMatchesAny(baseEvent, allowedEvents);
}

export function parallelDispatchBase(topic: string): string {
  if (!dispatchParallelTopic(topic)) return "";
  return topic.slice(0, -".parallel".length);
}

export function parallelJoinedTopic(topic: string): string {
  return `${topic}.joined`;
}

export function dispatchParallelJoinedTopic(topic: string): boolean {
  if (topic === "explore.parallel.joined") return false;
  return topic.endsWith(".parallel.joined");
}

export function dispatchParallelJoinBase(topic: string): string {
  if (topic === "explore.parallel.joined") return "loop.start";
  if (dispatchParallelJoinedTopic(topic)) {
    return topic.slice(0, -".parallel.joined".length);
  }
  return topic;
}

export function routingTopic(topic: string): boolean {
  const nonRouting = new Set([
    "iteration.start",
    "iteration.finish",
    "loop.complete",
    "loop.stop",
    "review.start",
    "review.finish",
    "backend.start",
    "backend.finish",
    "event.invalid",
    "",
  ]);
  if (nonRouting.has(topic)) return false;
  return !coordinationTopic(topic);
}

interface EmitValidation {
  runId: string;
  iteration: string;
  recentEvent: string;
  allowedRoles: string[];
  allowedEvents: string[];
  parallelEnabled: boolean;
  completionEvent: string;
}

function emitValidationContext(
  projectDir: string,
  journalFile: string,
): EmitValidation {
  const runId = resolveEmitRunId(journalFile);
  const cfg = config.loadProject(projectDir);
  const topo = topology.loadTopology(projectDir);
  const compEvent = topology.completionEvent(
    topo,
    config.get(cfg, "event_loop.completion_event", "task.complete"),
  );
  const parallelEnabled = truthySetting(
    config.get(cfg, "parallel.enabled", "false"),
  );

  return {
    runId,
    iteration: resolveEmitIteration(journalFile, runId),
    recentEvent: emitRecentEvent(),
    allowedRoles: envCsvList("AUTOLOOP_ALLOWED_ROLES"),
    allowedEvents: envCsvList("AUTOLOOP_ALLOWED_EVENTS"),
    parallelEnabled,
    completionEvent: compEvent,
  };
}

function resolveEmitRunId(journalFile: string): string {
  const envValue = process.env.AUTOLOOP_RUN_ID;
  return envValue || latestRunId(journalFile);
}

function resolveEmitIteration(journalFile: string, runId: string): string {
  const envValue = process.env.AUTOLOOP_ITERATION;
  return envValue || latestIterationForRun(journalFile, runId);
}

function emitRecentEvent(): string {
  return process.env.AUTOLOOP_RECENT_EVENT || "loop.start";
}

function envCsvList(name: string): string[] {
  const value = process.env[name];
  if (!value) return [];
  return splitCsv(value);
}

function acceptEmit(
  journalFile: string,
  topic: string,
  payload: string,
  validation: EmitValidation,
): void {
  appendAgentEvent(
    journalFile,
    validation.runId,
    validation.iteration,
    topic,
    payload,
  );
  console.log(`emitted ${topic}`);
  process.exitCode = 0;
}

function rejectEmit(
  journalFile: string,
  topic: string,
  validation: EmitValidation,
): void {
  const message = invalidEmitMessage(topic, validation);
  appendInvalidEvent(
    journalFile,
    validation.runId,
    validation.iteration,
    validation.recentEvent,
    topic,
    validation.allowedRoles,
    validation.allowedEvents,
  );
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function invalidEmitMessage(topic: string, validation: EmitValidation): string {
  return (
    "invalid event `" +
    topic +
    "`; recent event: `" +
    validation.recentEvent +
    "`; suggested roles: " +
    listText(validation.allowedRoles) +
    "; allowed next events: " +
    listText(validation.allowedEvents)
  );
}

export function appendInvalidEvent(
  journalFile: string,
  runId: string,
  iteration: string,
  recentEvent: string,
  emittedTopic: string,
  allowedRoles: string[],
  allowedEvents: string[],
): void {
  appendEvent(
    journalFile,
    runId,
    iteration,
    "event.invalid",
    jsonField("recent_event", recentEvent) +
      ", " +
      jsonField("emitted", emittedTopic) +
      ", " +
      jsonField("suggested_roles", joinCsv(allowedRoles)) +
      ", " +
      jsonField("allowed_events", joinCsv(allowedEvents)),
  );
}

export function resolveEmitJournalFile(projectDir: string): string {
  const envJournal = process.env.AUTOLOOP_JOURNAL_FILE;
  if (envJournal) return envJournal;
  const envEvents = process.env.AUTOLOOP_EVENTS_FILE;
  if (envEvents) return envEvents;
  return config.resolveJournalFile(projectDir);
}

function rejectTaskGate(
  journalFile: string,
  topic: string,
  openTasks: TaskEntry[],
  validation: EmitValidation,
): void {
  appendEvent(
    journalFile,
    validation.runId,
    validation.iteration,
    "task.gate",
    jsonField("blocked_topic", topic) +
      ", " +
      jsonField("open_tasks", openTasks.map((t) => t.id).join(",")),
  );

  const taskLines = openTasks.map((t) => `  - [${t.id}] ${t.text}`).join("\n");
  process.stderr.write(
    `Cannot complete: ${openTasks.length} open tasks remain:\n${taskLines}\nComplete or remove these tasks before emitting ${topic}.\n`,
  );
  process.exitCode = 1;
}

function truthySetting(value: string): boolean {
  return value !== "false" && value !== "0" && value !== "";
}
