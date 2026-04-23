import { joinCsv, listText } from "@mobrienv/autoloop-core";
import {
  appendHarnessEvent,
  extractField,
  extractIteration,
  extractTopic,
  readLines,
  readRunLines,
} from "@mobrienv/autoloop-core/journal";
import * as topology from "@mobrienv/autoloop-core/topology";
import { resolveRoleAgent } from "../agent-map.js";
import * as memory from "../memory.js";
import type { TwoTierMemoryStats } from "../memory-render.js";
import { materialize as materializeTasks } from "../tasks.js";
import { renderTasksPrompt } from "../tasks-render.js";
import {
  coordinationTopic,
  coreSystemTopic,
  parallelTopic,
  reservedParallelJoinedTopic,
  routingTopic,
  systemTopic,
} from "./emit.js";
import type { LoopContext } from "./index.js";
import { renderRunScratchpadPrompt } from "./scratchpad.js";

export interface IterationContext {
  iteration: number;
  recentEvent: string;
  allowedRoles: string[];
  allowedEvents: string[];
  backpressure: string;
  lastRejected: string;
  scratchpadText: string;
  memoryText: string;
  prompt: string;
  roleAgent: string;
}

interface DerivedRunContext {
  scratchpadText: string;
  memoryText: string;
  memoryStats: TwoTierMemoryStats;
  tasksText: string;
  tasksStats: { open: number; done: number; total: number };
  guidanceMessages: string[];
  routing: RoutingContext;
  backpressure: string;
  invalidCount: number;
  lastRejected: string;
}

function deriveRunContext(
  loop: LoopContext,
  runLines: string[],
): DerivedRunContext {
  const taskLines = readLines(loop.paths.tasksFile);
  const tasksMaterialized = materializeTasks(taskLines);
  const tasksText = renderTasksPrompt(
    tasksMaterialized,
    loop.tasks.budgetChars,
  );
  return {
    scratchpadText: renderRunScratchpadPrompt(runLines),
    memoryText: memory.renderTwoTier(
      loop.paths.memoryFile,
      loop.paths.runMemoryFile,
      loop.memory.budgetChars,
    ),
    memoryStats: memory.statsTwoTier(
      loop.paths.memoryFile,
      loop.paths.runMemoryFile,
      loop.memory.budgetChars,
    ),
    tasksText,
    tasksStats: {
      open: tasksMaterialized.open.length,
      done: tasksMaterialized.done.length,
      total: tasksMaterialized.open.length + tasksMaterialized.done.length,
    },
    guidanceMessages: drainGuidance(runLines),
    routing: iterationRoutingContext(loop.topology, runLines),
    backpressure: latestInvalidNote(runLines),
    invalidCount: invalidEventCount(runLines),
    lastRejected: lastRejectedTopic(runLines),
  };
}

export function buildIterationContext(
  loop: LoopContext,
  iteration: number,
): IterationContext {
  const runLines = readRunLines(loop.paths.journalFile, loop.runtime.runId);
  const derived = deriveRunContext(loop, runLines);
  const activeRole =
    derived.routing.allowedRoles.length === 1
      ? derived.routing.allowedRoles[0]
      : "";
  const roleAgent =
    resolveRoleAgent(loop.agentMap, loop.launch.preset, activeRole) || "";

  const prompt = renderIterationPromptText(loop, iteration, derived);

  if (derived.guidanceMessages.length > 0) {
    appendHarnessEvent(
      loop.paths.journalFile,
      loop.runtime.runId,
      String(iteration),
      "operator.guidance.consumed",
      `Consumed ${derived.guidanceMessages.length} guidance message(s)`,
    );
  }

  return {
    iteration,
    recentEvent: derived.routing.recentEvent,
    allowedRoles: derived.routing.allowedRoles,
    allowedEvents: derived.routing.allowedEvents,
    backpressure: derived.backpressure,
    lastRejected: derived.lastRejected,
    scratchpadText: derived.scratchpadText,
    memoryText: derived.memoryText,
    prompt,
    roleAgent,
  };
}

interface RoutingContext {
  recentEvent: string;
  allowedRoles: string[];
  allowedEvents: string[];
}

export function iterationRoutingContext(
  topo: topology.Topology,
  runLines: string[],
): RoutingContext {
  const recentEvent = routingEventFromLines(runLines);

  if (reservedParallelJoinedTopic(recentEvent)) {
    return joinedIterationRoutingContext(topo, runLines, recentEvent);
  }

  return {
    recentEvent,
    allowedRoles: topology.suggestedRoles(topo, recentEvent),
    allowedEvents: topology.allowedEvents(topo, recentEvent),
  };
}

function joinedIterationRoutingContext(
  topo: topology.Topology,
  runLines: string[],
  joinedTopic: string,
): RoutingContext {
  const joinLine = latestWaveJoinFinishLine(runLines, joinedTopic);
  const routingBasis = joinedRoutingBasis(joinLine, joinedTopic);
  const resumeRecentEvent = joinedRecentEvent(joinLine, joinedTopic);
  const fallbackRoles = topology.suggestedRoles(topo, routingBasis);
  const fallbackEvents = topology.allowedEvents(topo, routingBasis);
  const restoredRoles = csvFieldList(joinLine, "resume_roles");
  const restoredEvents = csvFieldList(joinLine, "resume_events");

  return {
    recentEvent: resumeRecentEvent,
    allowedRoles: restoredRoles.length > 0 ? restoredRoles : fallbackRoles,
    allowedEvents: restoredEvents.length > 0 ? restoredEvents : fallbackEvents,
  };
}

function latestWaveJoinFinishLine(
  lines: string[],
  joinedTopic: string,
): string {
  let current = "";
  for (const line of lines) {
    if (extractTopic(line) === "wave.join.finish") {
      if (extractField(line, "joined_topic") === joinedTopic) {
        current = line;
      }
    }
  }
  return current;
}

function joinedRoutingBasis(joinLine: string, joinedTopic: string): string {
  if (!joinLine) return defaultJoinedRoutingBasis(joinedTopic);
  const basis = extractField(joinLine, "routing_basis");
  return basis || defaultJoinedRoutingBasis(joinedTopic);
}

function defaultJoinedRoutingBasis(joinedTopic: string): string {
  if (joinedTopic === "explore.parallel.joined") return "loop.start";
  if (joinedTopic.endsWith(".parallel.joined")) {
    return joinedTopic.slice(0, -".parallel.joined".length);
  }
  return joinedTopic;
}

function joinedRecentEvent(joinLine: string, joinedTopic: string): string {
  if (!joinLine) return joinedTopic;
  return extractField(joinLine, "resume_recent_event") || joinedTopic;
}

function csvFieldList(line: string, field: string): string[] {
  if (!line) return [];
  const value = extractField(line, field);
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export function routingEventFromLines(lines: string[]): string {
  let current = "loop.start";
  for (const line of lines) {
    const topic = extractTopic(line);
    if (topic === "event.invalid") {
      const extracted = extractField(line, "recent_event");
      if (extracted) current = extracted;
    } else if (routingTopic(topic)) {
      current = topic;
    }
  }
  return current;
}

export function latestInvalidNote(runLines: string[]): string {
  let note = "";
  for (const line of runLines) {
    const topic = extractTopic(line);
    if (topic === "event.invalid") {
      note = invalidNoteFromLine(line);
    } else if (!systemTopic(topic)) {
      note = "";
    }
  }
  return note;
}

function invalidNoteFromLine(line: string): string {
  return (
    "Emitted `" +
    extractField(line, "emitted") +
    "` after `" +
    extractField(line, "recent_event") +
    "`.\n" +
    "Suggested roles: " +
    emptyListText(extractField(line, "suggested_roles")) +
    "\n" +
    "Allowed next events: " +
    emptyListText(extractField(line, "allowed_events")) +
    "\n" +
    "Re-emit using one of the allowed events above."
  );
}

function emptyListText(text: string): string {
  return text || "(none)";
}

export function invalidEventCount(runLines: string[]): number {
  let count = 0;
  for (const line of runLines) {
    if (extractTopic(line) === "event.invalid") count++;
  }
  return count;
}

export function lastRejectedTopic(runLines: string[]): string {
  let last = "";
  for (const line of runLines) {
    if (extractTopic(line) === "event.invalid") {
      last = extractField(line, "emitted");
    }
  }
  return last;
}

export function renderIterationPromptText(
  loop: LoopContext,
  iteration: number,
  derived: DerivedRunContext,
): string {
  const {
    routing,
    backpressure,
    memoryStats,
    memoryText,
    tasksText,
    tasksStats,
    guidanceMessages,
    scratchpadText,
    invalidCount,
    lastRejected,
  } = derived;
  const { allowedRoles, allowedEvents, recentEvent } = routing;
  return (
    "You are inside a bare-minimal autoloops harness.\n\n" +
    harnessInstructionsText(loop) +
    contextPressureText(memoryStats, tasksStats, invalidCount, lastRejected) +
    backpressureText(backpressure) +
    "Objective:\n" +
    loop.objective +
    "\n\n" +
    renderGuidanceSection(guidanceMessages) +
    (memoryText ? `${memoryText}\n` : "") +
    (tasksText ? `${tasksText}\n` : "") +
    topology.renderWithContext(
      loop.topology,
      recentEvent,
      allowedRoles,
      allowedEvents,
    ) +
    "\n" +
    parallelPromptText(loop, allowedEvents) +
    `Iteration: ${iteration}/${loop.limits.maxIterations}\n` +
    `Log level: ${loop.runtime.logLevel}\n` +
    `Completion event: ${loop.completion.event}\n` +
    `Completion promise fallback: ${loop.completion.promise}\n` +
    `Required events: ${loop.completion.requiredEvents.length === 0 ? "(none)" : joinCsv(loop.completion.requiredEvents)}\n` +
    `Loop-owned working files belong under: ${loop.paths.stateDir}\n` +
    `Do not leave loop-owned artifacts at the repo root. Use paths under ${loop.paths.stateDir} such as ${loop.paths.stateDir}/progress.md or ${loop.paths.stateDir}/logs/.\n` +
    `Suggested next roles now: ${listText(allowedRoles)}\n` +
    `Allowed next events now: ${listText(allowedEvents)}\n` +
    "Event tool: " +
    loop.paths.toolPath +
    "\n\n" +
    "Current scratchpad:\n" +
    (scratchpadText || "(empty)") +
    "\n\n" +
    "Use the event tool to publish your allowed handoff or completion event.\n" +
    "Examples:\n" +
    loop.paths.toolPath +
    ' emit <allowed-topic> "brief handoff summary"\n' +
    loop.paths.toolPath +
    " emit " +
    loop.completion.event +
    ' "brief completion summary"\n' +
    loop.paths.toolPath +
    ' memory add learning "durable lesson"\n' +
    loop.paths.toolPath +
    ' memory add preference Workflow "short preference note"\n' +
    loop.paths.toolPath +
    ' task add "description of work item"\n' +
    loop.paths.toolPath +
    " task complete task-1\n\n" +
    "Backpressure rule: if you emit an event outside the allowed next-event set, the loop will reject that handoff and ask you to re-route.\n" +
    "Prompt/output/scratchpad/memory are projections or stores you can inspect with `" +
    loop.paths.toolPath +
    ` inspect prompt ${iteration} --format md\`, \`` +
    loop.paths.toolPath +
    " inspect scratchpad --format md`, and `" +
    loop.paths.toolPath +
    " inspect memory --format md`.\n" +
    "Plain text alone does not publish an event. Prefer the event tool over the stdout completion promise.\n"
  );
}

export function renderReviewPromptText(
  loop: LoopContext,
  iteration: number,
  runLines: string[],
): string {
  const derived = deriveRunContext(loop, runLines);
  const {
    scratchpadText,
    memoryText,
    tasksText,
    memoryStats,
    tasksStats,
    guidanceMessages,
    routing,
    backpressure,
    invalidCount,
    lastRejected,
  } = derived;
  const latestIteration = String(maxReviewPromptIteration(runLines));

  const adversarialPreamble =
    iteration === 1 && loop.review.adversarialFirst
      ? "You are the adversarial gate for this loop. Your job is to be skeptical.\n" +
        "Assume the loop is wasting compute until proven otherwise.\n\n" +
        "After reviewing iteration 1 output, you MUST emit exactly one verdict:\n\n" +
        "- CONTINUE: The approach is correct AND more iterations will meaningfully improve output.\n" +
        "- REDIRECT: The approach is wrong or suboptimal. Provide a corrected task prompt.\n" +
        "- TAKEOVER: The task is trivial enough to solve now, or so broken that iterating won't help. Provide the solution directly.\n" +
        "- EXIT: Iteration 1 output is already sufficient. Stop.\n\n" +
        "Default to EXIT or REDIRECT. Only CONTINUE if you can articulate what specific improvements further iterations will produce.\n\n"
      : "";

  const verdictSchema =
    "\n## Verdict\n\n" +
    "You MUST include a JSON verdict block in your response:\n\n" +
    "```json\n" +
    "{\n" +
    '  "verdict": "CONTINUE | REDIRECT | TAKEOVER | EXIT",\n' +
    '  "confidence": 0.0,\n' +
    '  "reasoning": "One paragraph explaining the decision",\n' +
    '  "redirect_prompt": "New/amended task prompt (REDIRECT only)",\n' +
    '  "takeover_output": "Direct solution content (TAKEOVER only)",\n' +
    '  "suggestions": ["Optional list of specific improvements for CONTINUE"]\n' +
    "}\n" +
    "```\n";

  return (
    adversarialPreamble +
    "You are the metareview meta-reviewer for this loop.\n\n" +
    "Your job is to improve the loop itself, not to finish the task directly.\n" +
    "You may make bounded hygiene edits to runtime-facing loop files when that will improve the next iterations.\n" +
    `Safe edit targets include \`autoloops.toml\`, \`topology.toml\`, \`harness.md\`, \`metareview.md\`, \`roles/*.md\`, \`${loop.paths.stateDir}/context.md\`, \`${loop.paths.stateDir}/plan.md\`, \`${loop.paths.stateDir}/progress.md\`, \`${loop.paths.stateDir}/logs/\`, and \`${loop.paths.stateDir}/docs/*.md\`.\n` +
    `Keep loop-owned artifacts under \`${loop.paths.stateDir}/\`; do not leave loop-owned working files at the repo root.\n` +
    `Use \`${loop.paths.toolPath} memory add ...\` for short durable lessons or operator notes that should persist across turns.\n` +
    `Do not edit app/product source code, tests, package manifests, generated state under \`${loop.paths.stateDir}/\`, or journal history during review.\n` +
    "The scratchpad is projected from journal history, so do not try to edit it directly; instead tighten prompts, working files, or archived context so future iterations stay concise.\n" +
    "Do not emit normal loop events during review.\n\n" +
    reviewInstructionsText(loop) +
    contextPressureText(memoryStats, tasksStats, invalidCount, lastRejected) +
    backpressureText(backpressure) +
    renderGuidanceSection(guidanceMessages) +
    (memoryText ? `${memoryText}\n` : "") +
    (tasksText ? `${tasksText}\n` : "") +
    `Review trigger iteration: ${iteration}\n` +
    "Latest routing event: " +
    routing.recentEvent +
    "\n\n" +
    topology.renderWithContext(
      loop.topology,
      routing.recentEvent,
      routing.allowedRoles,
      routing.allowedEvents,
    ) +
    "\n" +
    "Current scratchpad:\n" +
    (scratchpadText || "(empty)") +
    "\n\n" +
    "Useful commands:\n" +
    loop.paths.toolPath +
    " inspect scratchpad --format md\n" +
    loop.paths.toolPath +
    " inspect memory --format md\n" +
    loop.paths.toolPath +
    " inspect prompt " +
    latestIteration +
    " --format md\n" +
    loop.paths.toolPath +
    " inspect output " +
    latestIteration +
    " --format text\n\n" +
    "If no improvements are needed, store a short learning explaining why and exit cleanly.\n" +
    verdictSchema
  );
}

export function drainGuidance(runLines: string[]): string[] {
  // Find the index of the last operator.guidance.consumed marker
  let consumedIdx = -1;
  for (let i = runLines.length - 1; i >= 0; i--) {
    if (extractTopic(runLines[i]) === "operator.guidance.consumed") {
      consumedIdx = i;
      break;
    }
  }

  // Collect all operator.guidance events after the last consumed marker
  const messages: string[] = [];
  for (let i = consumedIdx + 1; i < runLines.length; i++) {
    if (extractTopic(runLines[i]) === "operator.guidance") {
      const payload = extractField(runLines[i], "payload");
      if (payload) messages.push(payload);
    }
  }
  return messages;
}

function renderGuidanceSection(guidance: string[]): string {
  if (guidance.length === 0) return "";
  const body =
    guidance.length === 1
      ? guidance[0]
      : guidance.map((g, i) => `${i + 1}. ${g}`).join("\n");
  return (
    "## OPERATOR GUIDANCE\n\n" +
    body +
    "\n\n\u26a0\ufe0f Act on this guidance in this iteration. It will not be repeated.\n\n"
  );
}

function harnessInstructionsText(loop: LoopContext): string {
  if (!loop.harness.instructions) return "";
  return `Live harness instructions:\n${loop.harness.instructions}\n\n`;
}

function reviewInstructionsText(loop: LoopContext): string {
  if (!loop.review.prompt) return "";
  return `Additional metareview instructions:\n${loop.review.prompt}\n\n`;
}

function contextPressureText(
  memoryStats: TwoTierMemoryStats,
  tasksStats: { open: number; done: number; total: number },
  invalidCount: number,
  lastRejected: string,
): string {
  return (
    "Context pressure:\n" +
    "- Memory: " +
    memoryPressureSummary(memoryStats) +
    "\n" +
    "- Tasks: " +
    tasksPressureSummary(tasksStats) +
    "\n" +
    "- Invalid emits this run: " +
    invalidCount +
    invalidEmitHint(invalidCount, lastRejected) +
    "\n" +
    contextPressureRecommendation(memoryStats.truncated, invalidCount)
  );
}

function tasksPressureSummary(stats: {
  open: number;
  done: number;
  total: number;
}): string {
  if (stats.total === 0) return "no tasks";
  return `${stats.open} open, ${stats.done} done (${stats.total} total)`;
}

function memoryPressureSummary(stats: TwoTierMemoryStats): string {
  const p = stats.project;
  const r = stats.run;
  const parts: string[] = [];
  if (p.preferences.length > 0)
    parts.push(`${p.preferences.length} project preferences`);
  if (p.learnings.length > 0)
    parts.push(`${p.learnings.length} project learnings`);
  if (r.learnings.length > 0) parts.push(`${r.learnings.length} run learnings`);
  if (r.meta.length > 0) parts.push(`${r.meta.length} run meta`);
  if (p.meta.length > 0) parts.push(`${p.meta.length} project meta`);
  const totalEntries =
    p.preferences.length +
    p.learnings.length +
    p.meta.length +
    r.preferences.length +
    r.learnings.length +
    r.meta.length;
  const entryDetail = `${totalEntries} entries (${parts.length > 0 ? parts.join(", ") : "empty"})`;
  if (stats.truncated) {
    return `${stats.combinedRenderedChars}/${stats.budgetChars} chars across ${entryDetail} — truncated by ${stats.combinedRenderedChars - stats.budgetChars} chars (drop order: meta → learnings → preferences)`;
  }
  if (stats.budgetChars <= 0) {
    return `${stats.combinedRenderedChars} chars across ${entryDetail}; prompt budget disabled`;
  }
  return `${stats.combinedRenderedChars}/${stats.budgetChars} chars across ${entryDetail}`;
}

function invalidEmitHint(invalidCount: number, lastRejected: string): string {
  if (invalidCount === 0) return "";
  if (!lastRejected) return " — routing is currently under backpressure";
  return ` — routing backpressure; last rejected: \`${lastRejected}\``;
}

function contextPressureRecommendation(
  truncated: boolean,
  invalidCount: number,
): string {
  if (truncated || invalidCount > 0) {
    return "- Recommendation: consolidate stale or duplicate context before adding new memory, and re-route using the allowed-event set when needed.\n\n";
  }
  return "\n";
}

function backpressureText(text: string): string {
  return text ? `Backpressure:\n${text}\n\n` : "";
}

function parallelPromptText(
  loop: LoopContext,
  allowedEvents: string[],
): string {
  if (!loop.parallel.enabled || loop.runtime.branchMode) return "";
  const dispatch = parallelDispatchPromptEvents(
    allowedEvents,
    loop.completion.event,
  );
  const dispatchLine =
    dispatch.length === 0
      ? "- Dispatch fan-out is available as `<allowed-event>.parallel` for currently allowed normal handoff events.\n"
      : "- Dispatch fan-out is available now via `<allowed-event>.parallel`: " +
        dispatch.map((e) => `\`${e}\``).join(", ") +
        ".\n";
  return (
    "Structured parallelism:\n" +
    "- `explore.parallel` is available for exploratory self-loop fan-out before you choose the real next event.\n" +
    dispatchLine +
    `- Payloads must be a markdown bullet list or numbered list with 1..${loop.parallel.maxBranches} distinct branch objectives.\n` +
    "- Use fan-out only when branches are concrete, independently useful, and worth the barrier cost; keep one active wave at a time.\n" +
    `- Branches run in isolated state under \`${loop.paths.stateDir}/waves/\`; only the harness may emit \`*.parallel.joined\` to resume the parent after the join barrier.\n\n`
  );
}

function parallelDispatchPromptEvents(
  allowedEvents: string[],
  completionEvent: string,
): string[] {
  return allowedEvents
    .filter(
      (e) =>
        e !== completionEvent &&
        !coordinationTopic(e) &&
        !coreSystemTopic(e) &&
        !parallelTopic(e),
    )
    .map((e) => `${e}.parallel`);
}

function maxReviewPromptIteration(runLines: string[]): number {
  let current = 1;
  for (const line of runLines) {
    if (extractTopic(line) === "iteration.start") {
      const val = parseInt(extractIteration(line), 10);
      if (!Number.isNaN(val) && val > current) current = val;
    }
  }
  return current;
}
