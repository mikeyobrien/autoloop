import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePosixShell } from "@mobrienv/autoloop-core";
import { windowsCmdShim } from "@mobrienv/autoloop-harness/tools";

export interface ScriptInvocation {
  command: string;
  args: string[];
}

const isWin32 = process.platform === "win32";

/**
 * Run a `#!/usr/bin/env bash` / `#!/bin/sh` script. POSIX execs the script
 * directly; win32 has no shebang support, so the script runs through the
 * resolved POSIX shell (Git for Windows `sh.exe`).
 */
export function shellScriptInvocation(
  scriptPath: string,
  args: string[],
): ScriptInvocation {
  if (!isWin32) return { command: scriptPath, args };
  return { command: resolvePosixShell(), args: [scriptPath, ...args] };
}

/**
 * Run a `#!/usr/bin/env node` script. POSIX execs the script directly; win32
 * runs it through the current Node binary (argv[1] stays the script path).
 */
export function nodeScriptInvocation(
  scriptPath: string,
  args: string[],
): ScriptInvocation {
  if (!isWin32) return { command: scriptPath, args };
  return { command: process.execPath, args: [scriptPath, ...args] };
}

/**
 * Write an executable fake provider. On win32 a `#!/bin/sh` script also gets
 * a `<name>.cmd` sibling (same shim the harness writes for its tools), so
 * provider spawns that resolve `<path>.cmd` through PATHEXT can run it.
 */
export function writeExecutable(
  dir: string,
  name: string,
  content: string,
): string {
  const path = join(dir, name);
  writeFileSync(path, content, "utf-8");
  chmodSync(path, 0o755);
  if (isWin32 && content.startsWith("#!/bin/sh")) {
    writeFileSync(
      `${path}.cmd`,
      windowsCmdShim(resolvePosixShell(), path),
      "utf-8",
    );
  }
  return path;
}
