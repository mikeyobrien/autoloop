import { shellWords } from "@mobrienv/autoloop-core";
import type { LoopContext } from "../harness/types.js";

export function buildPiAdapterInvocation(
  loop: LoopContext,
  spec: { command: string; args: string[] },
): string {
  return shellWords([loop.paths.piAdapterPath, spec.command, ...spec.args]);
}
