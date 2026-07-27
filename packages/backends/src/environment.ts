import { realpathSync } from "node:fs";
import { delimiter, isAbsolute, relative, resolve, sep } from "node:path";

export type BackendEnvironmentPolicy = "inherit" | "hardened";

export interface BackendEnvironmentOptions {
  /** Repository or isolated worktree whose executables must not shadow trusted tools. */
  projectDir: string;
}

export interface ResolveBackendEnvironmentOptions
  extends BackendEnvironmentOptions {
  /** `inherit` preserves the process environment exactly; hardening is explicit. */
  policy?: BackendEnvironmentPolicy;
}

/**
 * Resolve the environment for a backend process without changing compatibility
 * defaults. Existing callers inherit the exact object they supplied; only an
 * explicit `hardened` policy invokes the sanitizer.
 */
export function resolveBackendEnvironment(
  source: NodeJS.ProcessEnv,
  options: ResolveBackendEnvironmentOptions,
): NodeJS.ProcessEnv {
  return options.policy === "hardened"
    ? sanitizeBackendEnvironment(source, options)
    : source;
}

const BLOCKED_EXACT = new Set([
  "BASH_ENV",
  "ENV",
  "GCONV_PATH",
  "JAVA_TOOL_OPTIONS",
  "JDK_JAVA_OPTIONS",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PERL5LIB",
  "PERL5OPT",
  "PYTHONHOME",
  "PYTHONPATH",
  "RUBYLIB",
  "RUBYOPT",
  "SSLKEYLOGFILE",
  "_JAVA_OPTIONS",
  "GIT_ASKPASS",
  "GIT_COMMON_DIR",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_SYSTEM",
  "GIT_DIR",
  "GIT_EDITOR",
  "GIT_EXEC_PATH",
  "GIT_EXTERNAL_DIFF",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PAGER",
  "GIT_PROXY_COMMAND",
  "GIT_SEQUENCE_EDITOR",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_TEMPLATE_DIR",
  "GIT_WORK_TREE",
  "SSH_ASKPASS",
]);

const BLOCKED_PREFIXES = [
  "BASH_FUNC_",
  "DYLD_",
  "LD_",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG_KEY_",
  "GIT_CONFIG_VALUE_",
];

const PROXY_KEYS = new Set(["ALL_PROXY", "HTTP_PROXY", "HTTPS_PROXY"]);

/**
 * Build the environment inherited by a model/backend process.
 *
 * General SDE agents still need ordinary project and toolchain variables, so
 * this is deliberately a denylist rather than the review-only helper's tiny
 * allowlist. The removed values are execution hooks or Git authority overrides
 * that let an ambient checkout/session replace code run by the harness.
 */
export function sanitizeBackendEnvironment(
  source: NodeJS.ProcessEnv,
  options: BackendEnvironmentOptions,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || blockedKey(key)) continue;
    if (PROXY_KEYS.has(key.toUpperCase())) validateProxy(key, value);
    env[key] = value;
  }

  if (env.PATH !== undefined) {
    env.PATH = sanitizePath(env.PATH, options.projectDir);
  }
  return env;
}

function blockedKey(key: string): boolean {
  const normalized = key.toUpperCase();
  return (
    BLOCKED_EXACT.has(normalized) ||
    BLOCKED_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

function sanitizePath(value: string, projectDir: string): string {
  const project = canonical(projectDir);
  return value
    .split(delimiter)
    .filter((entry) => {
      if (!entry || !isAbsolute(entry)) return false;
      return !isWithin(canonical(entry), project);
    })
    .join(delimiter);
}

function canonical(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function isWithin(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

function validateProxy(key: string, value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value.includes("://") ? value : `http://${value}`);
  } catch {
    throw new Error(`unsafe malformed proxy URL in ${key}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`unsafe credential-bearing proxy URL in ${key}`);
  }
  if (
    ![
      "http:",
      "https:",
      "socks:",
      "socks4:",
      "socks4a:",
      "socks5:",
      "socks5h:",
    ].includes(parsed.protocol) ||
    !parsed.hostname ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(`unsafe malformed proxy URL in ${key}`);
  }
}
