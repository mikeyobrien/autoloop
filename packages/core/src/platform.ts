/**
 * Platform helpers for the POSIX process primitives that autoloop relies on.
 *
 * autoloop generates and runs POSIX shell scripts (backend wrappers, the
 * agent tool script, hook commands). On Linux and macOS that shell is
 * `/bin/sh`. On Windows there is no `/bin/sh`, so the runtime uses the
 * `sh.exe` that Git for Windows ships. Process-group kills and SIGUSR1 also
 * have no Windows equivalent; the helpers below give each caller one
 * platform-aware entry point. The POSIX branch of every helper is the
 * behavior that existed before Windows support.
 *
 * See docs/rfcs/windows-support.md.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 } from "node:path";

const { delimiter, join, resolve } = win32;

export const POSIX_SHELL = "/bin/sh";

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/**
 * Read an env var by its Windows name: Windows env names are case-insensitive
 * (`Path`, `PATH`), a copied env object is not.
 */
export function windowsEnvValue(
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const direct = env[name];
  if (direct !== undefined) return direct;
  const upper = name.toUpperCase();
  const key = Object.keys(env).find((k) => k.toUpperCase() === upper);
  return key === undefined ? undefined : env[key];
}

/**
 * The absolute PATH entries, quotes stripped. Relative entries are dropped:
 * they would resolve against the caller's cwd.
 */
function absoluteWindowsPathDirs(env: NodeJS.ProcessEnv): string[] {
  return (windowsEnvValue(env, "PATH") ?? "")
    .split(delimiter)
    .map((dir) => dir.replace(/^"(.*)"$/, "$1"))
    .filter((dir) => win32.isAbsolute(dir));
}

/**
 * Find the file Windows would run for `name`, without the current directory.
 * Windows (libuv, cmd.exe) looks up a bare name in the cwd before PATH, so a
 * planted `git.exe` in a project would run; spawn the returned absolute path
 * instead. A bare name is searched in the absolute PATH entries; a name with
 * a separator must be an absolute path and is checked as is (resolve a
 * relative one first). A name without an extension gets each PATHEXT
 * extension in order. Returns undefined when nothing matches.
 */
export function findOnWindowsPath(
  name: string,
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  const exts = (windowsEnvValue(env, "PATHEXT") ?? DEFAULT_PATHEXT)
    .split(";")
    .filter((ext) => ext !== "");
  // Keep the name as given only when it already ends in a PATHEXT
  // extension (`python3.11` still gets `.exe` appended, as cmd does).
  const ext = win32.extname(name).toLowerCase();
  const names = exts.some((e) => e.toLowerCase() === ext)
    ? [name]
    : exts.map((e) => `${name}${e}`);
  if (/[\\/]/.test(name)) {
    if (!win32.isAbsolute(name)) return undefined;
    return names.find((candidate) => exists(candidate));
  }
  for (const dir of absoluteWindowsPathDirs(env)) {
    for (const file of names) {
      const candidate = resolve(dir, file);
      if (exists(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * `%SystemRoot%\System32\taskkill.exe` (`C:\Windows` when SystemRoot is
 * unset), so tree kills never look `taskkill` up through the cwd.
 */
export function taskkillPath(env: NodeJS.ProcessEnv = process.env): string {
  const systemRoot = windowsEnvValue(env, "SystemRoot") || "C:\\Windows";
  return join(systemRoot, "System32", "taskkill.exe");
}

/** Error raised on Windows when no POSIX shell can be found. */
export class PosixShellNotFoundError extends Error {
  readonly searched: string[];
  constructor(searched: string[]) {
    super(
      "autoloop needs a POSIX shell (sh.exe) on Windows. Install Git for " +
        "Windows (https://gitforwindows.org) or set AUTOLOOP_SHELL to the " +
        "full path of sh.exe or bash.exe. Searched: " +
        (searched.length > 0 ? searched.join(", ") : "(nothing)"),
    );
    this.name = "PosixShellNotFoundError";
    this.searched = searched;
  }
}

/** Injectable environment for the shell resolver (tests use fakes). */
export interface ShellProbe {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists: (path: string) => boolean;
  /** Output of `git --exec-path`, or undefined when git is not available. */
  gitExecPath: (env: NodeJS.ProcessEnv) => string | undefined;
}

/** Runner seam for `windowsGitExecPath` (tests inject fakes). */
export interface GitExecPathDeps {
  exists: (path: string) => boolean;
  run: (
    file: string,
    args: string[],
  ) => { status: number | null; stdout: string | null };
}

const defaultGitExecPathDeps: GitExecPathDeps = {
  exists: existsSync,
  run: (file, args) =>
    spawnSync(file, args, {
      encoding: "utf-8",
      windowsHide: true,
      timeout: 10_000,
    }),
};

/**
 * Output of `<git.exe> --exec-path`, with `git.exe` found through
 * `findOnWindowsPath` (never a bare `git`, which Windows looks up in the cwd
 * first). Undefined when git is not on PATH or fails.
 */
export function windowsGitExecPath(
  env: NodeJS.ProcessEnv,
  deps: GitExecPathDeps = defaultGitExecPathDeps,
): string | undefined {
  const git = findOnWindowsPath("git.exe", env, deps.exists);
  if (git === undefined) return undefined;
  try {
    const result = deps.run(git, ["--exec-path"]);
    if (result.status !== 0) return undefined;
    const out = (result.stdout ?? "").trim();
    return out === "" ? undefined : out;
  } catch {
    return undefined;
  }
}

function defaultProbe(): ShellProbe {
  return {
    platform: process.platform,
    env: process.env,
    exists: existsSync,
    gitExecPath: (env) => windowsGitExecPath(env),
  };
}

/** True for `%SystemRoot%\System32\bash.exe`, the WSL launcher. */
function isWslLauncher(path: string, env: NodeJS.ProcessEnv): boolean {
  const lower = path.toLowerCase().replace(/\//g, "\\");
  const root = (
    windowsEnvValue(env, "SystemRoot") ?? "C:\\Windows"
  ).toLowerCase();
  return (
    lower.startsWith(`${root}\\system32\\`) ||
    lower.startsWith(`${root}\\sysnative\\`) ||
    lower.includes("\\windowsapps\\")
  );
}

/**
 * The sh.exe under a Git for Windows install root. Only `bin\sh.exe`:
 * `usr\bin\sh.exe` started directly has no `/usr/bin` on PATH, so scripts
 * fail with `cut: command not found`.
 */
function gitRootShell(root: string): string {
  return join(root, "bin", "sh.exe");
}

/**
 * Ordered list of sh.exe candidates on Windows (exported for tests): the Git
 * root from `git --exec-path`, `%ProgramFiles%\Git`,
 * `%LOCALAPPDATA%\Programs\Git`, then `sh.exe`/`bash.exe` in each absolute
 * PATH entry (never the WSL launcher).
 */
export function windowsShellCandidates(probe: ShellProbe): string[] {
  const out: string[] = [];
  const execPath = probe.gitExecPath(probe.env);
  if (execPath) {
    // e.g. C:\Program Files\Git\mingw64\libexec\git-core -> C:\Program Files\Git
    out.push(gitRootShell(resolve(execPath, "..", "..", "..")));
  }
  const programFiles = windowsEnvValue(probe.env, "ProgramFiles");
  if (programFiles) out.push(gitRootShell(join(programFiles, "Git")));
  const localAppData = windowsEnvValue(probe.env, "LOCALAPPDATA");
  if (localAppData) {
    out.push(gitRootShell(join(localAppData, "Programs", "Git")));
  }
  for (const dir of absoluteWindowsPathDirs(probe.env)) {
    for (const name of ["sh.exe", "bash.exe"]) {
      const candidate = join(dir, name);
      if (!isWslLauncher(candidate, probe.env)) out.push(candidate);
    }
  }
  return [...new Set(out)];
}

/**
 * Resolve the POSIX shell without caching. On non-Windows platforms this is
 * always `/bin/sh`. On Windows: `AUTOLOOP_SHELL`, then Git for Windows, then
 * `sh.exe`/`bash.exe` on PATH (never the WSL launcher).
 */
export function findPosixShell(probe: ShellProbe = defaultProbe()): string {
  if (probe.platform !== "win32") return POSIX_SHELL;
  const override = windowsEnvValue(probe.env, "AUTOLOOP_SHELL");
  if (override !== undefined && override !== "") {
    if (probe.exists(override)) return override;
    throw new PosixShellNotFoundError([`AUTOLOOP_SHELL=${override}`]);
  }
  const candidates = windowsShellCandidates(probe);
  for (const candidate of candidates) {
    if (probe.exists(candidate)) return candidate;
  }
  throw new PosixShellNotFoundError(candidates);
}

let cachedShell: { key: string; shell: string } | undefined;

/**
 * Resolve the POSIX shell for `spawn`/`execSync` (`shell:` option or argv0).
 * The result is cached per `AUTOLOOP_SHELL` value. Throws
 * `PosixShellNotFoundError` on Windows when no shell exists.
 */
export function resolvePosixShell(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (process.platform !== "win32") return POSIX_SHELL;
  const key = windowsEnvValue(env, "AUTOLOOP_SHELL") ?? "";
  if (cachedShell && cachedShell.key === key) return cachedShell.shell;
  const shell = findPosixShell({ ...defaultProbe(), env });
  cachedShell = { key, shell };
  return shell;
}

/** Clear the resolver cache (tests only). */
export function resetPosixShellCache(): void {
  cachedShell = undefined;
}

/** True when the platform can deliver SIGUSR1 to another process. */
export function canSignalUsr1(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform !== "win32";
}

/**
 * Spawn options for a child that must be killable as a whole tree.
 * POSIX: a new process group (`detached`), killed with `process.kill(-pid)`.
 * Windows: no new console window; the tree is killed with `taskkill /T`.
 */
export function processGroupSpawnOptions(
  platform: NodeJS.Platform = process.platform,
): { detached: boolean; windowsHide?: boolean } {
  return platform === "win32"
    ? { detached: false, windowsHide: true }
    : { detached: true };
}

/** Runner seam for `killProcessTree` (tests inject fakes). */
export interface KillTreeDeps {
  platform: NodeJS.Platform;
  killGroup: (pid: number, signal: NodeJS.Signals) => void;
  taskkill: (pid: number) => number | null;
}

function defaultTaskkill(pid: number): number | null {
  const result = spawnSync(taskkillPath(), ["/PID", String(pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
    timeout: 15_000,
  });
  return result.status;
}

/**
 * Kill a process and all of its descendants.
 * POSIX: `process.kill(-pid, signal)` (the child must lead its own process
 * group, see `processGroupSpawnOptions`). Windows: `taskkill /PID /T /F`;
 * the signal is ignored because Windows has no graceful equivalent.
 * Returns false when the process (group) no longer exists.
 */
export function killProcessTree(
  pid: number,
  signal: NodeJS.Signals = "SIGTERM",
  deps: KillTreeDeps = {
    platform: process.platform,
    killGroup: (p, s) => process.kill(-p, s),
    taskkill: defaultTaskkill,
  },
): boolean {
  if (deps.platform === "win32") {
    // taskkill exits 128 when the pid does not exist.
    return deps.taskkill(pid) === 0;
  }
  try {
    deps.killGroup(pid, signal);
    return true;
  } catch {
    return false;
  }
}
