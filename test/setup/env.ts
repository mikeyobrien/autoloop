// Global vitest setup — runs before every test file.
//
// Neutralizes machine-specific state that would otherwise leak into the suite:
//
//   AUTOLOOP_CONFIG — point at a path that does not exist so the developer's
//   user-level ~/.config/autoloop/config.toml (which may set, e.g.,
//   backend.kind = "kiro") never bleeds into tests. Several harness/SDK tests
//   spawn the resolved default backend; without this they would try to launch
//   a real provider (kiro-cli, etc.) and hang. Config loading treats a missing
//   file as "no user config", giving every test the documented defaults.
//
// Tests that need a specific user config still override AUTOLOOP_CONFIG
// themselves (and restore it), so this only sets a safe default.

import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.AUTOLOOP_CONFIG) {
  process.env.AUTOLOOP_CONFIG = join(
    tmpdir(),
    "autoloop-tests-no-user-config.toml",
  );
}
