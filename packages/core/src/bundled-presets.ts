// Resolve the on-disk `presets/` directory shipped by
// @mobrienv/autoloop-presets, without coupling the resolver to CLI or
// harness code. Cached per-process because install topology is stable
// for a running node.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

let cached: string | null = null;

/**
 * Absolute path of the bundled presets directory, or "" when
 * `@mobrienv/autoloop-presets` is not resolvable from this module's
 * location (e.g. a trimmed install without the presets dep).
 */
export function bundledPresetsRoot(): string {
  if (cached !== null) return cached;
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("@mobrienv/autoloop-presets/package.json");
    const dir = join(dirname(pkgPath), "presets");
    cached = existsSync(dir) ? dir : "";
  } catch {
    cached = "";
  }
  return cached;
}

/** Test hook — reset the cached resolution. */
export function _resetBundledPresetsRootCache(): void {
  cached = null;
}
