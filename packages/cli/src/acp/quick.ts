// Quick-command executor for the ACP console.
//
// "Quick" commands are the synchronous CLI dispatchers (loops, inspect, list,
// memory, task, worktree, runs, config, control, guide, emit). They write
// human-readable text via console.log / stdout, so we invoke them with output
// captured and return the text for the ACP client to render as a message.

import * as harness from "@mobrienv/autoloop-harness";
import { dispatchChain } from "../commands/chain.js";
import { dispatchConfig } from "../commands/config.js";
import { dispatchControl } from "../commands/control.js";
import { dispatchGuide } from "../commands/guide.js";
import { dispatchInspect } from "../commands/inspect.js";
import { dispatchList } from "../commands/list.js";
import { dispatchLoops } from "../commands/loops.js";
import { dispatchMemory } from "../commands/memory.js";
import { dispatchRuns } from "../commands/runs.js";
import { dispatchTask } from "../commands/task.js";
import { dispatchWorktree } from "../commands/worktree.js";
import { type CaptureResult, captureOutput } from "./capture.js";

export interface QuickContext {
  bundleRoot: string;
  selfCmd: string;
  projectDir: string;
}

/**
 * Execute a quick command by name with the given args, capturing its output.
 * Returns the captured stdout/stderr and exit code. Throws for verbs that are
 * not quick commands (callers route stream/control verbs elsewhere).
 */
export async function runQuickCommand(
  name: string,
  args: string[],
  ctx: QuickContext,
): Promise<CaptureResult> {
  return captureOutput(async () => {
    switch (name) {
      case "loops":
        dispatchLoops(args);
        return;
      case "inspect":
        dispatchInspect(args);
        return;
      case "list":
        dispatchList(args, ctx.bundleRoot);
        return;
      case "memory":
        dispatchMemory(args);
        return;
      case "task":
        dispatchTask(args);
        return;
      case "worktree":
        dispatchWorktree(args);
        return;
      case "runs":
        dispatchRuns(args);
        return;
      case "config":
        dispatchConfig(args);
        return;
      case "control":
        dispatchControl(args);
        return;
      case "guide":
        dispatchGuide(args);
        return;
      case "emit": {
        const topic = args[0] ?? "";
        const summary = args.slice(1).join(" ");
        const result = harness.emit(ctx.projectDir, topic, summary);
        if (result.ok) {
          console.log(`emitted ${result.topic}`);
        } else {
          console.error(result.error ?? "emit failed");
          process.exitCode = 1;
        }
        return;
      }
      case "chain":
        await dispatchChain(args, ctx.selfCmd);
        return;
      default:
        throw new Error(`not a quick command: ${name}`);
    }
  });
}
