import { existsSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

/**
 * Read an optional text file without allowing a config-supplied path or symlink
 * to escape its declared root. Missing contained files remain optional; unsafe
 * paths fail closed.
 */
export function readOptionalContainedFile(
  rootDir: string,
  configuredPath: string,
  label = "configured file",
): string {
  return readContainedFileIfExists(rootDir, configuredPath, label) ?? "";
}

export function readContainedFileIfExists(
  rootDir: string,
  configuredPath: string,
  label = "configured file",
): string | undefined {
  if (!configuredPath) return undefined;
  const root = canonicalPath(rootDir);
  const candidate = resolve(root, configuredPath);
  assertWithin(candidate, root, label);

  if (!existsSync(candidate)) return undefined;
  const realCandidate = canonicalPath(candidate);
  assertWithin(realCandidate, root, label);
  return readFileSync(realCandidate, "utf-8");
}

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function assertWithin(candidate: string, root: string, label: string): void {
  const rel = relative(root, candidate);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..")) return;
  throw new Error(`${label} must stay within the ${rootLabel(label)}`);
}

function rootLabel(label: string): string {
  return label === "prompt_file" ? "preset directory" : "project directory";
}
