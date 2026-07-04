import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  joinCsv,
  jsonField,
  listText,
  splitCsv,
} from "@mobrienv/autoloop-core";
import * as config from "@mobrienv/autoloop-core/config";
import type { HookPhase, HookSpec } from "@mobrienv/autoloop-core/hooks-schema";
import {
  appendAgentEvent,
  appendEvent,
  latestIterationForRun,
  latestRunId,
} from "@mobrienv/autoloop-core/journal";
import type { TaskEntry } from "@mobrienv/autoloop-core/tasks";
import {
  materializeOpenFrom,
  resolveFile,
} from "@mobrienv/autoloop-core/tasks";
import * as topology from "@mobrienv/autoloop-core/topology";
import { printHookOutput } from "./display.js";
import { parseMutationDirective } from "./hooks.js";
import { writeSuspendState } from "./suspend-state.js";

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

interface EmitHookOutcome {
  blocked: boolean;
  blockedMessage?: string;
  mutatedTopic?: string;
  mutatedPayload?: string;
}

/**
 * Run pre_emit/post_emit hooks. `emit()` runs out-of-process (the agent
 * invokes the `autoloops emit` tool script, which spawns a fresh CLI process
 * calling `harness.emit()`) so there is no live `LoopContext` to drive
 * `runPhaseHooks` through — this is a disk/config-driven parallel
 * implementation reading `HookSpec`s straight from the project's raw TOML.
 *
 * `on_error = "suspend"` is honored as `block` here (see design note: the
 * emit subprocess cannot itself block the harness's iteration loop) but ALSO
 * writes durable suspend state, so the harness detects it at the next
 * iteration boundary (`runIteration` start) and halts there instead of
 * silently continuing.
 */
function runEmitPhaseHooks(
  projectDir: string,
  journalFile: string,
  phase: HookPhase,
  runId: string,
  iteration: string,
  topic: string,
  payload: string,
): EmitHookOutcome {
  const specs: HookSpec[] = config
    .loadHookSpecs(projectDir)
    .filter((s) => s.phase === phase);
  const outcome: EmitHookOutcome = { blocked: false };

  for (const spec of specs) {
    if (!spec.command) continue;
    const env: Record<string, string | undefined> = {
      ...process.env,
      AUTOLOOP_PROJECT_DIR: projectDir,
      AUTOLOOP_RUN_ID: runId,
      AUTOLOOP_ITERATION: iteration,
      AUTOLOOP_EMIT_TOPIC: outcome.mutatedTopic ?? topic,
      AUTOLOOP_EMIT_PAYLOAD: outcome.mutatedPayload ?? payload,
    };
    const result = spawnSync(spec.command, {
      shell: true,
      cwd: projectDir,
      encoding: "utf-8",
      env,
    });
    const combined =
      (result.stdout ?? "") +
      (result.stderr ? `\n[stderr]\n${result.stderr}` : "");
    const status = result.status ?? -1;
    const failed = status !== 0 || Boolean(result.error);

    appendEvent(
      journalFile,
      runId,
      iteration,
      "hook.output",
      `"hook": ${JSON.stringify(phase)}, "exit_code": ${status}, "output": ${JSON.stringify(combined.trim())}`,
    );
    printHookOutput(phase, status, combined.trim(), failed);

    if (!failed && spec.mutate === "event") {
      const directive = parseMutationDirective(
        combined.split("\n[stderr]\n")[0],
        "event",
      );
      if (directive) {
        if (directive.topic !== undefined)
          outcome.mutatedTopic = directive.topic;
        if (directive.payload !== undefined)
          outcome.mutatedPayload = directive.payload;
      }
    }

    if (!failed) continue;

    const detail =
      (result.stderr ?? "").trim() || (result.stdout ?? "").trim() || "";
    const msg = `hook ${phase} failed (exit ${status}): ${detail.split("\n")[0] ?? ""}`;

    if (spec.onError === "warn") continue;

    outcome.blocked = true;
    outcome.blockedMessage = msg;
    if (spec.onError === "suspend") {
      const stateDir =
        process.env.AUTOLOOP_STATE_DIR || config.stateDirPath(projectDir);
      writeSuspendState(
        stateDir,
        {
          runId,
          phase,
          iteration: Number(iteration) || 0,
          reason: msg,
          hookCommand: spec.command,
          createdAt: new Date().toISOString(),
          resumeIteration: Number(iteration) || 0,
        },
        journalFile,
      );
    }
    return outcome;
  }

  return outcome;
}

export function emit(
  projectDir: string,
  topic: string,
  payload: string,
): EmitResult {
  const result = emitCore(projectDir, topic, payload);
  if (!result.ok) return result;

  // post_emit hooks run after a successful accept. They cannot un-journal the
  // already-accepted event, but a `block` policy still surfaces as a failed
  // result (visible to the agent/CLI caller) and a `suspend` policy writes
  // durable suspend state for the harness to catch at the next iteration
  // boundary.
  const journalFile = resolveEmitJournalFile(projectDir);
  const validation = emitValidationContext(projectDir, journalFile);
  const postEmit = runEmitPhaseHooks(
    projectDir,
    journalFile,
    "post_emit",
    validation.runId,
    validation.iteration,
    result.topic ?? topic,
    payload,
  );
  if (postEmit.blocked) {
    return {
      ok: false,
      topic: result.topic,
      error: postEmit.blockedMessage ?? "post_emit hook blocked this event",
    };
  }
  return result;
}

function emitCore(
  projectDir: string,
  topic: string,
  payload: string,
): EmitResult {
  const journalFile = resolveEmitJournalFile(projectDir);
  mkdirSync(dirname(journalFile), { recursive: true });
  const validation = emitValidationContext(projectDir, journalFile);

  // pre_emit hooks: run before any gating so a configured mutation can steer
  // routing/gate decisions too. Runs disk/config-driven (see
  // `runEmitPhaseHooks`) since this call is out-of-process from the harness.
  const preEmit = runEmitPhaseHooks(
    projectDir,
    journalFile,
    "pre_emit",
    validation.runId,
    validation.iteration,
    topic,
    payload,
  );
  if (preEmit.mutatedTopic !== undefined) topic = preEmit.mutatedTopic;
  if (preEmit.mutatedPayload !== undefined) payload = preEmit.mutatedPayload;
  if (preEmit.blocked) {
    return {
      ok: false,
      topic,
      error: preEmit.blockedMessage ?? "pre_emit hook blocked this event",
    };
  }

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

  // The human-ask event is always accepted regardless of routing — it pauses
  // the loop for a human answer; the harness owns the block, not `[handoff]`.
  if (validation.askEvent !== "" && topic === validation.askEvent) {
    return acceptEmit(journalFile, topic, payload, validation);
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
    const tasksFile = resolveFile(projectDir);
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
    // Telemetry/observability emits, NOT routing. Without these the per-iteration
    // `backend.usage` (and any `hook.output`) would clobber the routing position every
    // cycle, collapsing topology backpressure to all-roles freedom after iteration 1 —
    // letting the agent self-route and skip required intermediate steps.
    "backend.usage",
    "hook.output",
    "hook.suspend",
    "event.invalid",
    "operator.guidance",
    "operator.guidance.consumed",
    // Human-in-the-loop topics are not routing: a `human.ask` pause must not
    // move the routing position, or the iteration after an ask would have an
    // empty allowed-event set (no topology transition) and the agent would be
    // unconstrained for that cycle. The ask.* topics are harness-written with
    // fixed names; `human.ask` is the default ask event.
    "human.ask",
    "ask.pending",
    "ask.answered",
    "ask.timeout",
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
  askEvent: string;
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
    askEvent: config.get(cfg, "event_loop.ask_event", "human.ask"),
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
