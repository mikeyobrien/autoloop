// Public SDK entry point for @mobrienv/autoloop.
//
// This module re-exports the minimal surface SDK consumers need to embed
// autoloop in their own code. It is deliberately narrow; everything else
// (CLI render helpers, preset resolution, dashboard, etc.) stays internal.
//
// Usage:
//   import { run, type LoopEvent } from "@mobrienv/autoloop";
//
//   const summary = await run(projectDir, prompt, "autoloop", {
//     signal: controller.signal,
//     onEvent: (e: LoopEvent) => console.log(e.type),
//   });

export { loadProject as loadProjectConfig } from "./config.js";
// Pure config helpers, for consumers who want to inspect merged config
// without re-implementing the schema layer.
export {
  type Config,
  defaults as configDefaults,
  get as configGet,
  getInt as configGetInt,
  getList as configGetList,
  type LayeredConfig,
  parseToml as parseConfigToml,
} from "./config-schema.js";
export type { EmitResult } from "./harness/emit.js";
export type { LoopEvent, LoopEventEmitter } from "./harness/events.js";
export { emit, run, runParallelBranchCli } from "./harness/index.js";
export type {
  LoopContext,
  RunOptions,
  RunSummary,
  TriggerSource,
  Verdict,
  VerdictKind,
} from "./harness/types.js";
