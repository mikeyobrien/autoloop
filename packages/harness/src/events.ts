// LoopEvent — the public event envelope for SDK consumers.
//
// Emitted by harness.run() via RunOptions.onEvent. Each Phase-1 commit moves
// one or more console.log call sites onto this stream; the default CLI
// event-printer (cli/event-printer.ts) renders them using the helpers in
// harness/display.ts. SDK consumers can ignore the display variants entirely
// or drive their own UI.

export type LoopEvent =
  // Structural — SDK consumers care about these.
  | { type: "log"; level: string; message: string }
  | {
      type: "iteration.start";
      iteration: number;
      maxIterations: number;
      runId: string;
    }
  | {
      type: "loop.finish";
      iterations: number;
      stopReason: string;
      runId: string;
    }
  // Display-requested — the harness asks the caller to render something.
  | {
      type: "iteration.banner";
      iteration: number;
      maxIterations: number;
      allowedRoles: string[];
      recentEvent: string;
      allowedEvents: string[];
      lastRejected?: string;
    }
  | { type: "iteration.footer"; iteration: number; elapsedS: number }
  | {
      type: "progress";
      runId: string;
      iteration: number;
      recentEvent: string;
      allowedRoles: string[];
      emittedTopic?: string;
      outcome: string;
    }
  | { type: "review.banner"; iteration: number }
  | { type: "backend.output"; output: string; maxLines?: number }
  | { type: "failure.diagnostic"; output: string; stopReason: string }
  | {
      type: "summary";
      runId: string;
      iterations: number;
      stopReason: string;
      journalFile: string;
      memoryFile: string;
      reviewEvery: number;
      toolPath: string;
    };

export type LoopEventEmitter = (event: LoopEvent) => void;
