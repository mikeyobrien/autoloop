/**
 * Spawn target for provider commands (`claude`, `codex`, `npx`, `pi`, ...).
 *
 * On win32 these are usually npm `.cmd` shims. Node >= 18.20.2 / 20.12.2
 * refuses to spawn `.cmd`/`.bat` without a shell (EINVAL), and libuv's PATH
 * search only tries `.com`/`.exe`, so a bare `claude` fails with ENOENT. When
 * the PATH/PATHEXT lookup finds a `.cmd`/`.bat`, the command runs through
 * `cmd.exe /d /s /c` with a pre-quoted command line (the cross-spawn escaping
 * from https://qntm.org/cmd, metacharacters escaped twice because npm shims
 * re-parse `%*`). When the lookup finds a `.exe`/`.com`, its absolute path is
 * spawned: libuv would search the current directory first for a bare name.
 * Every other case, and every non-win32 platform, spawns the command
 * unchanged.
 */

import { existsSync } from "node:fs";
import { win32 } from "node:path";
import { findOnWindowsPath, windowsEnvValue } from "@mobrienv/autoloop-core";

export interface SpawnTarget {
  command: string;
  args: string[];
  /** True when `args` is a pre-quoted cmd.exe command line. */
  windowsVerbatimArguments?: boolean;
}

export interface SpawnTargetOptions {
  /** Environment of the child; its PATH/PATHEXT drive the lookup. */
  env: NodeJS.ProcessEnv;
  /** Working directory of the child; resolves relative command paths. */
  cwd: string;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
}

const CMD_METACHARS = /([()\][%!^"`<>&|;, *?])/g;

export function resolveSpawnTarget(
  command: string,
  args: string[],
  options: SpawnTargetOptions,
): SpawnTarget {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return { command, args };
  const resolved = findWindowsCommand(command, options);
  if (resolved === undefined) return { command, args };
  if (/\.(exe|com)$/i.test(resolved)) return { command: resolved, args };
  if (!/\.(cmd|bat)$/i.test(resolved)) return { command, args };
  const line = [
    resolved.replace(CMD_METACHARS, "^$1"),
    ...args.map(escapeCmdShimArgument),
  ].join(" ");
  return {
    command: cmdExePath(options.env),
    args: ["/d", "/s", "/c", `"${line}"`],
    windowsVerbatimArguments: true,
  };
}

/**
 * Quote one argument for `cmd.exe /s /c` running a batch file that forwards
 * it with `%*` (npm cmd shims), so the target process receives it verbatim.
 */
export function escapeCmdShimArgument(arg: string): string {
  // Every backslash in a run before a quote or the closing quote is doubled;
  // quotes are backslash-escaped (MSVCRT argv rules for the final process).
  let quoted = arg.replace(/(\\*)"/g, '$1$1\\"');
  quoted = quoted.replace(/(\\*)$/, "$1$1");
  quoted = `"${quoted}"`.replace(CMD_METACHARS, "^$1");
  // Second pass: the batch file's `%*` expansion is parsed by cmd again.
  return quoted.replace(CMD_METACHARS, "^$1");
}

/**
 * Find the file cmd.exe would run for `command`: a path is resolved against
 * `cwd`; a bare name is searched in the absolute PATH entries only
 * (`findOnWindowsPath`).
 */
function findWindowsCommand(
  command: string,
  options: SpawnTargetOptions,
): string | undefined {
  const name = /[\\/]/.test(command)
    ? win32.resolve(options.cwd, command)
    : command;
  return findOnWindowsPath(name, options.env, options.exists ?? existsSync);
}

function cmdExePath(env: NodeJS.ProcessEnv): string {
  const comspec = windowsEnvValue(env, "ComSpec");
  if (comspec) return comspec;
  const systemRoot = windowsEnvValue(env, "SystemRoot") ?? "C:\\Windows";
  return win32.join(systemRoot, "System32", "cmd.exe");
}
