import { accessSync, constants, statSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import type { ClaudeSdkClientOptions } from "./claude-sdk-client.js";

const COMPILED_BUN_ROOT = "/$bunfs/root/";

/**
 * Resolve the SDK's native executable only where its bundled path cannot work:
 * a Bun-compiled standalone. Installed Node and ordinary Bun runtimes keep the
 * SDK default, while configured commands retain exact precedence.
 */
export function resolveClaudeCodeExecutable(
  opts: Pick<ClaudeSdkClientOptions, "command" | "cwd" | "env">,
): string | undefined {
  if (opts.command) return opts.command;
  if (!isCompiledBun()) return undefined;

  const effectiveEnv = opts.env ?? process.env;
  const pathValue = effectiveEnv.PATH;
  if (pathValue !== undefined) {
    for (const directory of pathValue.split(delimiter)) {
      const candidate = resolve(opts.cwd, directory, "claude");
      try {
        accessSync(candidate, constants.X_OK);
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Keep searching after missing, inaccessible, or non-executable entries.
      }
    }
  }

  throw new Error(
    'Unable to find the "claude" executable required by the compiled autoloop standalone. Install Claude Code and ensure an executable named "claude" is available on PATH.',
  );
}

function isCompiledBun(): boolean {
  const bun = (globalThis as Record<string, unknown>).Bun;
  if ((typeof bun !== "object" && typeof bun !== "function") || bun === null) {
    return false;
  }
  const main = (bun as { main?: unknown }).main;
  return typeof main === "string" && main.startsWith(COMPILED_BUN_ROOT);
}
