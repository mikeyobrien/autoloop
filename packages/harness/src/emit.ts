import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  joinCsv,
  jsonField,
  listText,
  splitCsv,
} from "@mobrienv/autoloop-core";
import * as config from "@mobrienv/autoloop-core/config";
import {
  appendAgentEvent,
  appendEvent,
  latestIterationForRun,
  latestRunId,
} from "@mobrienv/autoloop-core/journal";
import type { TaskEntry } from "@mobrienv/autoloop-core/tasks";
import {
  materializeOpenFrom,
  resolveFile as resolveTasksFile,
} from "@mobrienv/autoloop-core/tasks";
import * as topology from "@mobrienv/autoloop-core/topology";

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

const OPERATOR_TOPICS = new Set([
  "operator.guidance",
  "operator.guidance.consumed",
]);

export function operatorTopic(topic: string): boolean {
  return OPERATOR_TOPICS.has(topic);
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
  "backend.usage",
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

export interface EmitResult {
  ok: boolean;
  topic?: string;
  error?: string;
}

export function emit(
  projectDir: string,
  topic: string,
  payload: string,
): EmitResult {
  const journalFile = resolveEmitJournalFile(projectDir);
  mkdirSync(dirname(journalFile), { recursive: true });
  const validation = emitValidationContext(projectDir, journalFile);

  // Evidence gate (opt-in): applies to ANY configured event, BEFORE routing /
  // coordination / completion handling, so a declared gate is never silently
  // bypassed (e.g. on a coordination/operator topic). A success event must
  // carry its required evidence in the payload, else it is rejected and the
  // typed `blocked` event is journaled instead — preserving an evidence-bearing
  // quality gate over a topology that otherwise only checks routing. No
  // `[[gate]]` for this topic => no-op.
  const gate = topology.gateForEvent(validation.topo, topic);
  if (gate && gate.requires.length > 0) {
    const missing = missingEvidence(gate.requires, payload);
    if (missing.length > 0) {
      return rejectEvidenceGate(
        journalFile,
        topic,
        gate,
        missing,
        payload,
        validation,
      );
    }
  }

  if (coordinationTopic(topic)) {
    return acceptEmit(journalFile, topic, payload, validation);
  }

  if (operatorTopic(topic)) {
    return acceptEmit(journalFile, topic, payload, validation);
  }

  // Task completion gate: block completion if open blocking tasks remain.
  // Soft tasks (soft === true) are advisory and never block completion.
  //
  // Resolve via tasks.resolveFile (NOT config.resolveTasksFile) so the gate
  // honors the AUTOLOOP_TASKS_FILE env override — the same resolver the task
  // CLI and the agent's `task add`/`task complete` use (tools.ts exports
  // AUTOLOOP_TASKS_FILE into the agent env). This keeps the gate reading the
  // exact store the tasks are written to, including when an external parent
  // (e.g. ralph) points autoloop at a canonical store. Using the config path
  // here would silently read a different file and miss open tasks.
  if (topic === validation.completionEvent) {
    const tasksFile = resolveTasksFile(projectDir);
    const blockingTasks = materializeOpenFrom(tasksFile).filter(
      (t) => t.soft !== true,
    );
    if (blockingTasks.length > 0) {
      return rejectTaskGate(journalFile, topic, blockingTasks, validation);
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
    return rejectEmit(journalFile, topic, validation);
  }

  return acceptEmit(journalFile, topic, payload, validation);
}

/**
 * Whether a JSON value counts as evidence: a non-empty string, a finite number
 * (incl. 0, e.g. `errors=0`), or `true`. Empty strings, `false`, `null`,
 * objects, and arrays do NOT count — they are vacuous and must not satisfy a
 * gate.
 */
function isEvidenceValue(v: unknown): boolean {
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "boolean") return v === true;
  return false;
}

/**
 * Evidence keys present in a payload. A key is "present" only when it carries a
 * *machine-checkable* value:
 *
 * - a `key=value` token (the value must immediately follow `=`), or
 * - a top-level key in a JSON object payload with a non-empty scalar value.
 *
 * The `=` (or JSON) requirement is deliberate: a free-prose `key: value` form
 * would let ordinary English that merely mentions a required word satisfy the
 * gate (e.g. "tests: all green, coverage: looks good"), defeating the point of
 * requiring proof. So colon-prose does NOT count — agents must emit structured
 * `key=value` pairs or a JSON object. Matching is case-sensitive on the key.
 */
export function payloadEvidenceKeys(payload: string): Set<string> {
  const present = new Set<string>();
  if (!payload) return present;

  // JSON object payloads: top-level keys with a non-empty scalar value.
  const trimmed = payload.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        if (isEvidenceValue(v)) present.add(k);
      }
    } catch {
      // not JSON — fall through to token scan
    }
  }

  // Structured `key=value` tokens. The value must immediately follow `=` (no
  // space skip), so a trailing `key=` with no value is absent, and free prose
  // is not matched. Values may be quoted.
  const re = /([A-Za-z_][\w.-]*)=("[^"]*"|'[^']*'|[^\s,;]+)/g;
  let m: RegExpExecArray | null = re.exec(payload);
  while (m !== null) {
    const value = m[2].replace(/^["']|["']$/g, "").trim();
    if (value !== "") present.add(m[1]);
    m = re.exec(payload);
  }
  return present;
}

/** Required evidence keys absent from the payload, in declaration order. */
export function missingEvidence(requires: string[], payload: string): string[] {
  const present = payloadEvidenceKeys(payload);
  return requires.filter((key) => !present.has(key));
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
    "operator.guidance",
    "operator.guidance.consumed",
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
  topo: topology.Topology;
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
    topo,
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
): EmitResult {
  appendAgentEvent(
    journalFile,
    validation.runId,
    validation.iteration,
    topic,
    payload,
  );
  return { ok: true, topic };
}

function rejectEmit(
  journalFile: string,
  topic: string,
  validation: EmitValidation,
): EmitResult {
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
  return { ok: false, topic, error: message };
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

function rejectEvidenceGate(
  journalFile: string,
  topic: string,
  gate: topology.Gate,
  missing: string[],
  payload: string,
  validation: EmitValidation,
): EmitResult {
  // Journal the typed blocked event with the evidence shortfall + the original
  // summary, so an observer (and the next iteration's prompt) sees why it was
  // blocked and what is still needed.
  appendEvent(
    journalFile,
    validation.runId,
    validation.iteration,
    gate.blocked,
    jsonField("gated_event", topic) +
      ", " +
      jsonField("missing_evidence", joinCsv(missing)) +
      ", " +
      jsonField("required_evidence", joinCsv(gate.requires)) +
      ", " +
      jsonField("summary", payload),
  );
  return {
    ok: false,
    topic,
    error:
      "`" +
      topic +
      "` requires evidence " +
      listText(gate.requires) +
      "; missing: " +
      listText(missing) +
      ". Emitted `" +
      gate.blocked +
      "` instead. Include the evidence in the payload (e.g. `key=value`) and emit `" +
      topic +
      "` again.",
  };
}

function rejectTaskGate(
  journalFile: string,
  topic: string,
  openTasks: TaskEntry[],
  validation: EmitValidation,
): EmitResult {
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
  const message = `Cannot complete: ${openTasks.length} open tasks remain:\n${taskLines}\nComplete or remove these tasks before emitting ${topic}.`;
  return { ok: false, topic, error: message };
}

function truthySetting(value: string): boolean {
  return value !== "false" && value !== "0" && value !== "";
}
