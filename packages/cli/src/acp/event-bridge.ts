// Event bridge — maps the harness LoopEvent stream onto ACP session/update
// notifications so an ACP client renders a running loop as a live tool call
// with streaming output.
//
// Mapping:
//   iteration.start    -> tool_call (kind execute, in_progress) on first
//                         iteration; tool_call_update (title) thereafter
//   progress           -> tool_call_update content + agent_message_chunk
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
  private runId: string | undefined;
  private stopReason = "";
  private verbose: boolean;

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
      case "iteration.start":
        await this.onIterationStart(event);
        return;
      case "progress":
        await this.onProgress(event);
        return;
      case "backend.output":
        if (event.output.trim()) {
          await this.message(event.output);
        }
        return;
      case "log":
        if (this.verbose && event.message.trim()) {
          await this.thought(`[${event.level}] ${event.message}`);
        }
        return;
      case "failure.diagnostic":
        this.failed = true;
        this.stopReason = event.stopReason;
        await this.message(`Failure: ${event.output}`);
        return;
      case "loop.finish":
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

  private async onIterationStart(
    event: Extract<LoopEvent, { type: "iteration.start" }>,
  ): Promise<void> {
    this.runId = event.runId;
    const title = `Iteration ${event.iteration}/${event.maxIterations}`;
    if (!this.toolStarted) {
      this.toolStarted = true;
      await this.sink.update({
        sessionUpdate: "tool_call",
        toolCallId: this.toolCallId,
        title,
        kind: "execute",
        status: "in_progress",
      });
    } else {
      await this.sink.update({
        sessionUpdate: "tool_call_update",
        toolCallId: this.toolCallId,
        title,
      });
    }
  }

  private async onProgress(
    event: Extract<LoopEvent, { type: "progress" }>,
  ): Promise<void> {
    const parts = [
      `iteration ${event.iteration}`,
      `event: ${event.recentEvent}`,
      `outcome: ${event.outcome}`,
    ];
    if (event.emittedTopic) parts.push(`emitted: ${event.emittedTopic}`);
    await this.toolContent(parts.join(" | "));
  }

  private async onFinish(): Promise<void> {
    if (!this.toolStarted) {
      // Loop finished before any iteration banner (e.g. immediate exit).
      await this.sink.update({
        sessionUpdate: "tool_call",
        toolCallId: this.toolCallId,
        title: "Loop",
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

  private async toolContent(text: string): Promise<void> {
    await this.sink.update({
      sessionUpdate: "tool_call_update",
      toolCallId: this.toolCallId,
      content: [{ type: "content", content: { type: "text", text } }],
    });
  }
}

function isCancelled(stopReason: string): boolean {
  const r = stopReason.toLowerCase();
  return r.includes("cancel") || r.includes("abort") || r.includes("signal");
}
