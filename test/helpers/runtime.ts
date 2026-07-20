import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../..");
export const DIST_ENTRY = resolve(ROOT, "packages/cli/dist/main.js");
export const MOCK_BACKEND = resolve(ROOT, "dist/testing/mock-backend.js");
export const MOCK_ACP_SERVER = resolve(ROOT, "dist/testing/mock-acp-server.js");
export const FIXTURES_DIR = resolve(ROOT, "test/fixtures/backend");
export const PRESET_FIXTURE_DIR = resolve(
  ROOT,
  "test/fixtures/presets/minimal",
);

let buildEnsured = false;
const tempProjects = new Set<string>();

export interface CliResult {
  stdout: string;
  stderr: string;
  status: number | null;
  signal: NodeJS.Signals | null;
  spawnError?: string;
}

export function ensureBuild(): void {
  if (
    buildEnsured &&
    existsSync(DIST_ENTRY) &&
    existsSync(MOCK_BACKEND) &&
    existsSync(MOCK_ACP_SERVER)
  )
    return;
  if (
    !existsSync(DIST_ENTRY) ||
    !existsSync(MOCK_BACKEND) ||
    !existsSync(MOCK_ACP_SERVER)
  ) {
    // Build every workspace + root so packages/cli/dist/main.js and
    // dist/testing/mock-backend.js both exist. A plain root `tsc` no
    // longer suffices — phase 2.6 moved the CLI into its own workspace.
    execFileSync("npm", ["run", "build"], {
      cwd: ROOT,
      timeout: 120_000,
    });
  }
  buildEnsured = true;
}

export function makeTempProject(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `autoloop-${name}-`));
  tempProjects.add(dir);
  cpSync(PRESET_FIXTURE_DIR, dir, { recursive: true });
  const configPath = join(dir, "autoloops.toml");
  let config = readFileSync(configPath, "utf-8");
  config = config.replace(
    'backend.command = "echo"',
    'backend.command = "node"',
  );
  config += `
backend.args = [${JSON.stringify(MOCK_BACKEND)}]
`;
  writeFileSync(configPath, config, "utf-8");
  return dir;
}

export function cleanupTempProjects(): void {
  for (const dir of tempProjects) rmSync(dir, { recursive: true, force: true });
  tempProjects.clear();
}

export function readText(path: string): string {
  return readFileSync(path, "utf-8");
}

export function pathExists(path: string): boolean {
  return existsSync(path);
}

function inferCwd(args: string[]): string {
  if (args[0] === "run" && args[1]) return args[1];
  if (args[0] === "inspect" && args[2] && !args[2].startsWith("--"))
    return args[2];
  return ROOT;
}

function cleanEnv(
  env: Record<string, string>,
): Record<string, string | undefined> {
  const base: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(base)) {
    if (key.startsWith("AUTOLOOP_")) delete base[key];
  }
  return { ...base, ...env };
}

export function runCli(
  args: string[],
  env: Record<string, string>,
  cwd?: string,
): CliResult {
  const res = spawnSync("node", [DIST_ENTRY, ...args], {
    cwd: cwd || inferCwd(args),
    encoding: "utf-8",
    timeout: 60_000,
    env: cleanEnv(env),
  });
  return {
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    status: res.status,
    signal: res.signal,
    spawnError: res.error?.message,
  };
}

export function expectCliStatus(result: CliResult, expected: number): void {
  if (result.status === expected) return;
  throw new Error(
    [
      `Expected CLI status ${expected}, received ${String(result.status)}.`,
      `signal: ${result.signal ?? "none"}`,
      `spawn error: ${result.spawnError ?? "none"}`,
      `stdout: ${result.stdout || "<empty>"}`,
      `stderr: ${result.stderr || "<empty>"}`,
    ].join("\n"),
  );
}

export function inspectCli(
  args: string[],
  env: Record<string, string> = {},
  cwd?: string,
): string {
  return execFileSync("node", [DIST_ENTRY, ...args], {
    cwd: cwd || inferCwd(args),
    encoding: "utf-8",
    timeout: 30_000,
    env: cleanEnv(env),
  });
}
