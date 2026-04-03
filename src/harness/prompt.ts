import * as topology from "../topology.js";
import * as memory from "../memory.js";
import { listText, joinCsv, lineSep } from "../utils.js";
import {
  extractTopic,
  extractField,
  extractIteration,
  readRunLines,
} from "./journal.js";
import { renderRunScratchpadPrompt } from "./scratchpad.js";
import {
  routingTopic,
  systemTopic,
  coordinationTopic,
  coreSystemTopic,
  parallelTopic,
  reservedParallelJoinedTopic,
  parallelDispatchBase,
} from "./emit.js";
import type { LoopContext } from "./index.js";

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
}

export function buildIterationContext(
  loop: LoopContext,
  iteration: number,
): IterationContext {
  const runLines = readRunLines(
    loop.paths.journalFile,
    loop.runtime.runId,
  );
  const scratchpadText = renderRunScratchpadPrompt(runLines);
  const routing = iterationRoutingContext(loop.topology, runLines);
  const backpressure = latestInvalidNote(runLines);
  const memoryText = memory.renderFile(
    loop.paths.memoryFile,
    loop.memory.budgetChars,
  );
  const memoryStats = memory.statsFile(
    loop.paths.memoryFile,
    loop.memory.budgetChars,
  );
  const invalidCount = invalidEventCount(runLines);
  const lastRejected = lastRejectedTopic(runLines);

  return {
    iteration,
    recentEvent: routing.recentEvent,
    allowedRoles: routing.allowedRoles,
    allowedEvents: routing.allowedEvents,
    backpressure,
    lastRejected,
    scratchpadText,
    memoryText,
    prompt: renderIterationPromptText(
      loop,
      iteration,
      routing.recentEvent,
      routing.allowedRoles,
      routing.allowedEvents,
      backpressure,
      invalidCount,
      lastRejected,
      scratchpadText,
      memoryText,
      memoryStats,
    ),
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
    allowedEvents:
      restoredEvents.length > 0 ? restoredEvents : fallbackEvents,
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
  return value.split(",").map((s) => s.trim()).filter((s) => s !== "");
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
  recentEvent: string,
  allowedRoles: string[],
  allowedEvents: string[],
  backpressure: string,
  invalidCount: number,
  lastRejected: string,
  scratchpadText: string,
  memoryText: string,
  memoryStats: { renderedChars: number; budgetChars: number; totalEntries: number; preferences: number; learnings: number; meta: number; truncated: boolean },
): string {
  return (
    "You are inside a bare-minimal autoloops harness.\n\n" +
    harnessInstructionsText(loop) +
    contextPressureText(memoryStats, invalidCount, lastRejected) +
    backpressureText(backpressure) +
    "Objective:\n" +
    loop.objective +
    "\n\n" +
    (memoryText ? memoryText + "\n" : "") +
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
    `Required events: ${(loop.completion.requiredEvents.length === 0 ? "(none)" : joinCsv(loop.completion.requiredEvents))}\n` +
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
    ' memory add preference Workflow "short preference note"\n\n' +
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
  const scratchpadText = renderRunScratchpadPrompt(runLines);
  const memoryText = memory.renderFile(
    loop.paths.memoryFile,
    loop.memory.budgetChars,
  );
  const memoryStatsData = memory.statsFile(
    loop.paths.memoryFile,
    loop.memory.budgetChars,
  );
  const routing = iterationRoutingContext(loop.topology, runLines);
  const backpressure = latestInvalidNote(runLines);
  const invalidCount = invalidEventCount(runLines);
  const lastRejected = lastRejectedTopic(runLines);
  const latestIteration = String(maxReviewPromptIteration(runLines));

  return (
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
    contextPressureText(memoryStatsData, invalidCount, lastRejected) +
    backpressureText(backpressure) +
    (memoryText ? memoryText + "\n" : "") +
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
    "If no improvements are needed, store a short learning explaining why and exit cleanly.\n"
  );
}

function harnessInstructionsText(loop: LoopContext): string {
  if (!loop.harness.instructions) return "";
  return "Live harness instructions:\n" + loop.harness.instructions + "\n\n";
}

function reviewInstructionsText(loop: LoopContext): string {
  if (!loop.review.prompt) return "";
  return "Additional metareview instructions:\n" + loop.review.prompt + "\n\n";
}

function contextPressureText(
  memoryStats: { renderedChars: number; budgetChars: number; totalEntries: number; preferences: number; learnings: number; meta: number; truncated: boolean },
  invalidCount: number,
  lastRejected: string,
): string {
  return (
    "Context pressure:\n" +
    "- Memory: " +
    memoryPressureSummary(memoryStats) +
    "\n" +
    "- Invalid emits this run: " +
    invalidCount +
    invalidEmitHint(invalidCount, lastRejected) +
    "\n" +
    contextPressureRecommendation(memoryStats.truncated, invalidCount)
  );
}

function memoryPressureSummary(stats: {
  renderedChars: number;
  budgetChars: number;
  totalEntries: number;
  preferences: number;
  learnings: number;
  meta: number;
  truncated: boolean;
}): string {
  const entryDetail = `${stats.totalEntries} entries (${stats.preferences} preferences, ${stats.learnings} learnings, ${stats.meta} meta)`;
  if (stats.truncated) {
    return `${stats.renderedChars}/${stats.budgetChars} chars across ${entryDetail} — truncated by ${stats.renderedChars - stats.budgetChars} chars (drop order: meta → learnings → preferences)`;
  }
  if (stats.budgetChars <= 0) {
    return `${stats.renderedChars} chars across ${entryDetail}; prompt budget disabled`;
  }
  return `${stats.renderedChars}/${stats.budgetChars} chars across ${entryDetail}`;
}

function invalidEmitHint(invalidCount: number, lastRejected: string): string {
  if (invalidCount === 0) return "";
  if (!lastRejected) return " — routing is currently under backpressure";
  return " — routing backpressure; last rejected: `" + lastRejected + "`";
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
  return text ? "Backpressure:\n" + text + "\n\n" : "";
}

function parallelPromptText(loop: LoopContext, allowedEvents: string[]): string {
  if (!loop.parallel.enabled || loop.runtime.branchMode) return "";
  const dispatch = parallelDispatchPromptEvents(allowedEvents, loop.completion.event);
  const dispatchLine = dispatch.length === 0
    ? "- Dispatch fan-out is available as `<allowed-event>.parallel` for currently allowed normal handoff events.\n"
    : "- Dispatch fan-out is available now via `<allowed-event>.parallel`: " + dispatch.map((e) => "`" + e + "`").join(", ") + ".\n";
  return "Structured parallelism:\n" +
    "- `explore.parallel` is available for exploratory self-loop fan-out before you choose the real next event.\n" +
    dispatchLine +
    `- Payloads must be a markdown bullet list or numbered list with 1..${loop.parallel.maxBranches} distinct branch objectives.\n` +
    "- Use fan-out only when branches are concrete, independently useful, and worth the barrier cost; keep one active wave at a time.\n" +
    `- Branches run in isolated state under \`${loop.paths.stateDir}/waves/\`; only the harness may emit \`*.parallel.joined\` to resume the parent after the join barrier.\n\n`;
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
    .map((e) => e + ".parallel");
}

function maxReviewPromptIteration(runLines: string[]): number {
  let current = 1;
  for (const line of runLines) {
    if (extractTopic(line) === "iteration.start") {
      const val = parseInt(extractIteration(line), 10);
      if (!isNaN(val) && val > current) current = val;
    }
  }
  return current;
}
