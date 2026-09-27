// herdr pane status sink — when autoloop runs inside a herdr terminal pane,
// report what the loop is doing so the herdr workspace list shows it without
// switching panes, and raise notifications when the operator is needed.
//
// The policy (`herdrActions`) is a pure LoopEvent -> HerdrAction[] mapping; the
// shell (`herdrEventSink`) turns actions into `herdr` argv and spawns them
// fire-and-forget. The sink never awaits, never throws, and never writes to
// stdout/stderr, so it cannot slow or break the loop. Disable with
// AUTOLOOP_HERDR=0.

import { spawn } from "node:child_process";
import { classifyStopReason } from "@mobrienv/autoloop-harness";
import type { LoopEvent } from "@mobrienv/autoloop-harness/events";

export type HerdrAction =
  | { kind: "status"; state: "working" | "blocked" | "idle"; message: string }
  | { kind: "title"; title: string }
  | { kind: "notify"; title: string; body: string; sound: "done" | "request" }
  | { kind: "release" };

export interface HerdrState {
  runId: string;
}

/** Progress topics that mean the loop hit a wall the operator should see. */
const ATTENTION_TOPICS = new Set([
  "review.rejected",
  "build.blocked",
  "finalization.failed",
]);

function runLabel(state: HerdrState): string {
  return state.runId || "autoloop";
}

/**
 * Map one LoopEvent to the herdr actions it implies. Pure apart from recording
 * the run id on `state` from events that carry it.
 */
export function herdrActions(
  event: LoopEvent,
  state: HerdrState,
): HerdrAction[] {
  if ("runId" in event && event.runId) state.runId = event.runId;
  switch (event.type) {
    case "iteration.banner": {
      const role = event.allowedRoles.join("/") || "any";
      const backend = event.backend.model || event.backend.kind;
      return [
        {
          kind: "status",
          state: "working",
          message: `iter ${event.iteration} · ${role} · ${backend}`,
        },
        { kind: "title", title: `autoloop ${runLabel(state)} · ${role}` },
      ];
    }
    case "ask.pending":
      return [
        {
          kind: "status",
          state: "blocked",
          message: `asking: ${event.question}`,
        },
        {
          kind: "notify",
          title: `${runLabel(state)}: needs an answer`,
          body: event.question,
          sound: "request",
        },
      ];
    case "wait.open":
      return [
        {
          kind: "status",
          state: "blocked",
          message: `waiting: ${event.name || event.reason}`,
        },
      ];
    case "ask.answered":
    case "wait.close":
      return [
        {
          kind: "status",
          state: "working",
          message: `iter ${event.iteration} · resumed`,
        },
      ];
    case "progress":
      if (!event.emittedTopic || !ATTENTION_TOPICS.has(event.emittedTopic))
        return [];
      return [
        {
          kind: "notify",
          title: `${runLabel(state)}: ${event.emittedTopic}`,
          body: `iteration ${event.iteration}`,
          sound: "request",
        },
      ];
    // `summary` precedes `loop.finish` on a normal stop, but only `loop.finish`
    // is emitted on an unexpected throw, so it is the single terminal event.
    case "loop.finish": {
      const cost = event.costUsd > 0 ? ` · $${event.costUsd.toFixed(2)}` : "";
      const failed = classifyStopReason(event.stopReason) === "failed";
      const outcome = failed ? `failed: ${event.stopReason}` : event.stopReason;
      return [
        {
          kind: "status",
          state: failed ? "blocked" : "idle",
          message: outcome,
        },
        // herdr does not surface the status message, so the title carries it.
        { kind: "title", title: `autoloop ${runLabel(state)} · ${outcome}` },
        {
          kind: "notify",
          title: `${runLabel(state)}: ${event.stopReason}`,
          body: `${event.iterations} iterations${cost}`,
          sound: failed ? "request" : "done",
        },
      ];
    }
    default:
      return [];
  }
}

const SOURCE = "autoloop";
const AGENT = "autoloop";

/** Translate one action to `herdr` argv (without the binary). */
export function herdrArgv(
  action: HerdrAction,
  paneId: string,
  seq: number,
): string[] {
  const owner = ["--source", SOURCE, "--agent", AGENT];
  switch (action.kind) {
    case "status":
      return [
        "pane",
        "report-agent",
        paneId,
        ...owner,
        "--state",
        action.state,
        "--message",
        action.message,
        "--seq",
        String(seq),
      ];
    case "title":
      return [
        "pane",
        "report-metadata",
        paneId,
        ...owner,
        "--title",
        action.title,
      ];
    case "notify":
      return [
        "notification",
        "show",
        action.title,
        "--body",
        action.body,
        "--sound",
        action.sound,
      ];
    case "release":
      return ["pane", "release-agent", paneId, ...owner, "--seq", String(seq)];
  }
}

export type HerdrExec = (bin: string, argv: string[]) => void;

export const spawnHerdr: HerdrExec = (bin, argv) => {
  try {
    const child = spawn(bin, argv, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Best-effort: herdr reporting must never affect the loop.
  }
};

export interface HerdrSink {
  onEvent: (event: LoopEvent) => void;
  /** Drop this run's claim on the pane, e.g. when a signal stops the process. */
  release: () => void;
  /**
   * Normal process exit: a finished run keeps its final report standing
   * (herdr shows idle as done, blocked as failed); an unfinished one releases.
   */
  close: () => void;
}

/**
 * Build the herdr sink, or undefined when not inside a herdr pane
 * (HERDR_PANE_ID unset) or when disabled with AUTOLOOP_HERDR=0.
 */
export function herdrEventSink(
  env: NodeJS.ProcessEnv = process.env,
  exec: HerdrExec = spawnHerdr,
): HerdrSink | undefined {
  const paneId = env.HERDR_PANE_ID;
  if (!paneId || env.AUTOLOOP_HERDR === "0") return undefined;
  const bin = env.HERDR_BIN_PATH || "herdr";
  const state: HerdrState = { runId: "" };
  // Seed from the clock so seq stays monotonic across successive runs in the
  // same pane, in case herdr drops reports older than the last seen seq.
  let seq = Date.now();
  let claimed = false;
  let finished = false;
  const run = (action: HerdrAction): void => {
    if (action.kind === "status") claimed = true;
    if (action.kind === "release") {
      if (!claimed) return;
      claimed = false;
    }
    const needsSeq = action.kind === "status" || action.kind === "release";
    try {
      exec(bin, herdrArgv(action, paneId, needsSeq ? ++seq : seq));
    } catch {
      // A throwing exec must not reach the loop.
    }
  };
  return {
    onEvent(event: LoopEvent): void {
      for (const action of herdrActions(event, state)) run(action);
      if (event.type === "loop.finish") finished = true;
    },
    release(): void {
      run({ kind: "release" });
    },
    close(): void {
      if (!finished) run({ kind: "release" });
    },
  };
}
