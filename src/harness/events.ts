// LoopEvent — the public event envelope for SDK consumers.
//
// Emitted by harness.run() via RunOptions.onEvent. The union is narrow by
// design; new variants land here as each Phase-1 commit moves a concrete
// console.log call site onto the event stream.

export type LoopEvent =
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
    };

export type LoopEventEmitter = (event: LoopEvent) => void;
