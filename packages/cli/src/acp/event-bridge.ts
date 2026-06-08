// Event bridge — maps the harness LoopEvent stream onto ACP session/update
// notifications so an ACP client renders a running loop as a live tool call
// with streaming output.
//
// Mapping:
//   iteration.start    -> tool_call (kind execute, in_progress) on first
//                         iteration; tool_call_update (title) thereafter
//   progress           -> agent_message_chunk (the per-iteration update,
//                         surfaced as a priority assistant message)
//   backend.output     -> agent_message_chunk (the model/tool text)
//   log                -> agent_thought_chunk (debug/info narration)
//   failure.diagnostic -> tool_call_update status=failed + message chunk
//   loop.finish        -> tool_call_update status=completed (or failed) and
//                         records the stop reason for the prompt response
//
// A single loop run maps to a single tool call so the ACP client groups all of
// its sub-output under one collapsible node.

import type { LoopEvent } from "@mobrienv/autoloop-harness/events";

export interface SessionUpdateSink {
  /** Emit a SessionUpdate for the given session. */
  update(update: AcpSessionUpdate): void | Promise<void>;
}

// Minimal structural shapes for the ACP SessionUpdate variants we emit. We use
// local types rather than importing the SDK schema so this module stays
// testable without a live connection; they are assignable to the SDK types.
type TextBlock = { type: "text"; text: string };

export type AcpSessionUpdate =
  | { sessionUpdate: "agent_message_chunk"; content: TextBlock }
  | { sessionUpdate: "agent_thought_chunk"; content: TextBlock }
  | {
      sessionUpdate: "tool_call";
      toolCallId: string;
      title: string;
      kind: "execute";
      status: "in_progress";
    }
  | {
      sessionUpdate: "tool_call_update";
      toolCallId: string;
      status?: "in_progress" | "completed" | "failed";
      title?: string;
      content?: Array<{ type: "content"; content: TextBlock }>;
    };

export interface BridgeResult {
  /** The ACP stop reason derived from the loop outcome. */
  stopReason: "end_turn" | "cancelled";
  /** Number of iterations the loop reported, if known. */
  iterations: number;
  /** Run id, if the loop reported one. */
  runId?: string;
  /** Final human summary line. */
  summary: string;
}

/**
 * Stateful translator. Construct one per prompt turn (one loop run), feed it
 * LoopEvents via handle(), and read the accumulated outcome from result().
 */
export class EventBridge {
  private readonly sink: SessionUpdateSink;
  private readonly toolCallId: string;
  private toolStarted = false;
  private failed = false;
  private cancelled = false;
  private iterations = 0;
  private iteration = 0;
  private maxIterations = 0;
  private runId: string | undefined;
  private preset = "";
  private workDir = "";
  private stopReason = "";
  private verbose: boolean;
  /** Whether the in-flight iteration has emitted any backend output yet. */
  private sawOutputThisIteration = false;
  /** The most recent progress event, used to explain a silent iteration. */
  private lastProgress: Extract<LoopEvent, { type: "progress" }> | undefined;

  constructor(
    sink: SessionUpdateSink,
    toolCallId: string,
    opts: { verbose?: boolean } = {},
  ) {
    this.sink = sink;
    this.toolCallId = toolCallId;
    this.verbose = opts.verbose ?? false;
  }

  /** Translate one LoopEvent into zero or more session updates. */
  async handle(event: LoopEvent): Promise<void> {
    switch (event.type) {
      case "loop.start":
        await this.onLoopStart(event);
        return;
      case "iteration.start":
        await this.onIterationStart(event);
        return;
      case "progress":
        await this.onProgress(event);
        return;
      case "backend.output":
        if (event.output.trim()) {
          this.sawOutputThisIteration = true;
          await this.message(event.output);
        }
        return;
      case "log":
        await this.onLog(event);
        return;
      case "failure.diagnostic":
        this.failed = true;
        this.stopReason = event.stopReason;
        await this.message(`Failure: ${event.output}`);
        return;
      case "loop.finish":
        await this.flushSilentIteration();
        this.iterations = event.iterations;
        this.runId = event.runId;
        this.stopReason = event.stopReason;
        if (isCancelled(event.stopReason)) this.cancelled = true;
        await this.onFinish();
        return;
      default:
        // summary/banner/footer/review variants are display-only; ignore.
        return;
    }
  }

  /** Mark the turn cancelled (called when the client sends session/cancel). */
  markCancelled(): void {
    this.cancelled = true;
  }

  result(): BridgeResult {
    const stopReason = this.cancelled ? "cancelled" : "end_turn";
    const outcome = this.cancelled
      ? "cancelled"
      : this.failed
        ? "failed"
        : "completed";
    const runPart = this.runId ? ` (run ${this.runId})` : "";
    return {
      stopReason,
      iterations: this.iterations,
      runId: this.runId,
      summary: `Loop ${outcome} after ${this.iterations} iteration${
        this.iterations === 1 ? "" : "s"
      }${runPart}${this.stopReason ? ` — ${this.stopReason}` : ""}`,
    };
  }

  private async onLoopStart(
    event: Extract<LoopEvent, { type: "loop.start" }>,
  ): Promise<void> {
    this.runId = event.runId;
    this.preset = event.preset;
    this.workDir = event.workDir;
    // Open the tool call named after the run id so the ACP client identifies
    // this session by its run, not an anonymous iteration counter.
    if (!this.toolStarted) {
      this.toolStarted = true;
      await this.sink.update({
        sessionUpdate: "tool_call",
        toolCallId: this.toolCallId,
        title: this.title(),
        kind: "execute",
        status: "in_progress",
      });
    } else {
      await this.sink.update({
        sessionUpdate: "tool_call_update",
        toolCallId: this.toolCallId,
        title: this.title(),
      });
    }
    // Emit a "this is what we're doing" header describing the run.
    await this.message(renderRunHeader(event));
  }

  private async onIterationStart(
    event: Extract<LoopEvent, { type: "iteration.start" }>,
  ): Promise<void> {
    // A new iteration is starting — if the previous one produced no output,
    // explain why instead of leaving the ACP client showing nothing.
    await this.flushSilentIteration();
    this.runId = event.runId;
    this.iteration = event.iteration;
    this.maxIterations = event.maxIterations;
    this.sawOutputThisIteration = false;
    this.lastProgress = undefined;
    if (!this.toolStarted) {
      // No loop.start was observed (older harness or branch run) — open the
      // tool call here as a fallback.
      this.toolStarted = true;
      await this.sink.update({
        sessionUpdate: "tool_call",
        toolCallId: this.toolCallId,
        title: this.title(),
        kind: "execute",
        status: "in_progress",
      });
    } else {
      await this.sink.update({
        sessionUpdate: "tool_call_update",
        toolCallId: this.toolCallId,
        title: this.title(),
      });
    }
  }

  /**
   * Build the tool-call title. The run id is the session's stable identity;
   * the preset prefixes it and the iteration counter is appended once
   * iterations begin: `{preset} · run {runId} · iter N/M`.
   */
  private title(): string {
    const id = this.runId ? `run ${this.runId}` : "autoloop";
    const presetPart = this.preset ? `${this.preset} · ` : "";
    if (this.iteration > 0) {
      return `${presetPart}${id} · iter ${this.iteration}/${this.maxIterations}`;
    }
    return `${presetPart}${id}`;
  }

  /**
   * Route harness log events to the ACP client. autoloop's own narration
   * (info / warn / error) is surfaced as assistant messages so the operator
   * sees what the loop is doing and any warnings it raises. debug logs are
   * lower-signal and only surface as agent thoughts when verbose is enabled.
   */
  private async onLog(
    event: Extract<LoopEvent, { type: "log" }>,
  ): Promise<void> {
    const message = event.message.trim();
    if (!message) return;
    if (event.level === "debug") {
      if (this.verbose) await this.thought(`[debug] ${message}`);
      return;
    }
    // The "loop start run_id=…" info log is internal bookkeeping that the
    // richer loop.start header already conveys — skip it to avoid a redundant
    // assistant message.
    if (event.level === "info" && message.startsWith("loop start run_id=")) {
      return;
    }
    // info / warn / error → assistant message. Prefix non-info levels so the
    // severity is visible in the client.
    const text =
      event.level === "info" ? message : `[${event.level}] ${message}`;
    await this.message(text);
  }

  private async onProgress(
    event: Extract<LoopEvent, { type: "progress" }>,
  ): Promise<void> {
    this.lastProgress = event;
    const parts = [
      `iteration ${event.iteration}`,
      `event: ${event.recentEvent}`,
      `outcome: ${event.outcome}`,
    ];
    if (event.emittedTopic) parts.push(`emitted: ${event.emittedTopic}`);
    // The per-iteration update is a priority message for the end-user, mirroring
    // the dashboard's run detail view — emit it as a top-level assistant message
    // rather than burying it as collapsed tool-call content. It also counts as
    // real output, so the "produced no message output" fallback does not fire.
    this.sawOutputThisIteration = true;
    await this.message(parts.join(" | "));
  }

  /**
   * If the iteration that just ended produced no agent message output, emit a
   * short status chunk explaining what happened (emitted event / outcome).
   * This replaces the previous behavior of staying completely silent, which an
   * ACP client renders as an unhelpful "[no output]" placeholder.
   */
  private async flushSilentIteration(): Promise<void> {
    if (this.iteration === 0) return;
    if (this.sawOutputThisIteration) return;
    const p = this.lastProgress;
    const detail = p
      ? [
          p.emittedTopic ? `emitted \`${p.emittedTopic}\`` : "no event emitted",
          `outcome: ${p.outcome}`,
        ].join(", ")
      : "no event emitted";
    await this.message(
      `Iteration ${this.iteration} produced no message output (${detail}).`,
    );
    // Avoid emitting the same note twice if both iteration.start and
    // loop.finish call this for the same iteration.
    this.sawOutputThisIteration = true;
  }

  private async onFinish(): Promise<void> {
    if (!this.toolStarted) {
      // Loop finished before any iteration banner (e.g. immediate exit).
      await this.sink.update({
        sessionUpdate: "tool_call",
        toolCallId: this.toolCallId,
        title: this.title(),
        kind: "execute",
        status: "in_progress",
      });
      this.toolStarted = true;
    }
    await this.sink.update({
      sessionUpdate: "tool_call_update",
      toolCallId: this.toolCallId,
      status: this.failed || this.cancelled ? "failed" : "completed",
    });
  }

  private async message(text: string): Promise<void> {
    await this.sink.update({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    });
  }

  private async thought(text: string): Promise<void> {
    await this.sink.update({
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text },
    });
  }
}

function isCancelled(stopReason: string): boolean {
  const r = stopReason.toLowerCase();
  return r.includes("cancel") || r.includes("abort") || r.includes("signal");
}

/**
 * Render the "this is what we're doing" header emitted at loop start. It gives
 * the ACP client an at-a-glance summary of the run's identity and parameters
 * before any iteration output streams in.
 */
export function renderRunHeader(
  event: Extract<LoopEvent, { type: "loop.start" }>,
): string {
  const lines = [
    `autoloop run \`${event.runId}\``,
    "",
    `preset:     ${event.preset}`,
    `backend:    ${event.backend}`,
    `directory:  ${event.workDir}`,
    `iterations: max ${event.maxIterations}`,
  ];
  const completion: string[] = [];
  if (event.completionEvent)
    completion.push(`event \`${event.completionEvent}\``);
  if (event.completionPromise)
    completion.push(`promise \`${event.completionPromise}\``);
  if (completion.length > 0) {
    lines.push(`completion: ${completion.join(" or ")}`);
  }
  const prompt = event.prompt.trim();
  if (prompt) {
    lines.push("", "objective:", prompt);
  }
  return lines.join("\n");
}
