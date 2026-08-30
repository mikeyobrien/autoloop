// Hermetic test environment: isolate the suite from the developer's machine so
// `npm test` is reproducible regardless of a global ~/.config/autoloop/config.toml
// or a non-UTC local timezone. Without this, a dev with e.g.
// `[backend] kind="claude"` or `[profiles] default="user:intent"` in their global
// config, or a TZ like AEST, sees spurious failures in config-helpers / profiles /
// sdk-smoke / loops-render that pass cleanly in CI.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Pin the timezone (some renderers format timestamps in local time).
process.env.TZ = "UTC";

// Point autoloop at an empty config so the developer's global [backend]/[profiles]
// defaults can't leak into unit tests. An explicit AUTOLOOP_CONFIG is left untouched
// so individual tests can still supply their own config when they need one.
if (!process.env.AUTOLOOP_CONFIG) {
  const cfg = join(
    mkdtempSync(join(tmpdir(), "autoloop-hermetic-")),
    "config.toml",
  );
  writeFileSync(cfg, "");
  process.env.AUTOLOOP_CONFIG = cfg;
}

// `git commit` in beforeEach (file-mod-audit, tamper, postconditions) inherits
// the developer's global commit.gpgsign / core.fsmonitor. Signing + fsmonitor
// on throwaway /tmp repos stalls past vitest's 10s hookTimeout under coverage.
// GIT_CONFIG_* is `git -c` precedence and leaves the rest of global config.
if (!process.env.GIT_CONFIG_COUNT) {
  process.env.GIT_CONFIG_COUNT = "2";
  process.env.GIT_CONFIG_KEY_0 = "commit.gpgsign";
  process.env.GIT_CONFIG_VALUE_0 = "false";
  process.env.GIT_CONFIG_KEY_1 = "core.fsmonitor";
  process.env.GIT_CONFIG_VALUE_1 = "false";
}
