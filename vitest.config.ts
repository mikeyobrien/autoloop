import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Alias workspace packages to their source so vitest mocks of relative paths
// inside the source tree still apply. Otherwise consumers go through dist/
// and vi.mock("../src/foo.js") misses because the module id differs.
const CORE = resolve(import.meta.dirname, "packages/core/src");
const HARNESS = resolve(import.meta.dirname, "packages/harness/src");
const BACKENDS = resolve(import.meta.dirname, "packages/backends/src");
const DASHBOARD = resolve(import.meta.dirname, "packages/dashboard/src");
const ISSUE_SYNC_CORE = resolve(
  import.meta.dirname,
  "packages/issue-sync-core/src",
);
const GH_SYNC = resolve(import.meta.dirname, "packages/gh-sync/src");
const LINEAR_SYNC = resolve(import.meta.dirname, "packages/linear-sync/src");

export default defineConfig({
  resolve: {
    alias: {
      "@mobrienv/autoloop-core/config-schema": `${CORE}/config-schema.ts`,
      "@mobrienv/autoloop-core/config": `${CORE}/config.ts`,
      "@mobrienv/autoloop-core/hooks-schema": `${CORE}/hooks-schema.ts`,
      "@mobrienv/autoloop-core/agent-map": `${CORE}/agent-map.ts`,
      "@mobrienv/autoloop-core/profiles": `${CORE}/profiles.ts`,
      "@mobrienv/autoloop-core/tasks-render": `${CORE}/tasks-render.ts`,
      "@mobrienv/autoloop-core/tasks": `${CORE}/tasks.ts`,
      "@mobrienv/autoloop-core/memory-render": `${CORE}/memory-render.ts`,
      "@mobrienv/autoloop-core/memory": `${CORE}/memory.ts`,
      "@mobrienv/autoloop-core/journal-format": `${CORE}/journal-format.ts`,
      "@mobrienv/autoloop-core/journal": `${CORE}/journal.ts`,
      "@mobrienv/autoloop-core/evidence": `${CORE}/evidence.ts`,
      "@mobrienv/autoloop-core/topology": `${CORE}/topology.ts`,
      "@mobrienv/autoloop-core/fanout": `${CORE}/fanout.ts`,
      "@mobrienv/autoloop-core/concurrency": `${CORE}/concurrency.ts`,
      "@mobrienv/autoloop-core/registry/discover": `${CORE}/registry/discover.ts`,
      "@mobrienv/autoloop-core/registry/read": `${CORE}/registry/read.ts`,
      "@mobrienv/autoloop-core/registry/types": `${CORE}/registry/types.ts`,
      "@mobrienv/autoloop-core/registry/derive": `${CORE}/registry/derive.ts`,
      "@mobrienv/autoloop-core/registry/rebuild": `${CORE}/registry/rebuild.ts`,
      "@mobrienv/autoloop-core/registry/update": `${CORE}/registry/update.ts`,
      "@mobrienv/autoloop-core/registry": `${CORE}/registry/index.ts`,
      "@mobrienv/autoloop-core/runs-health": `${CORE}/runs-health.ts`,
      "@mobrienv/autoloop-core/worktree": `${CORE}/worktree/index.ts`,
      "@mobrienv/autoloop-core/isolation/resolve": `${CORE}/isolation/resolve.ts`,
      "@mobrienv/autoloop-core/isolation/run-scope": `${CORE}/isolation/run-scope.ts`,
      "@mobrienv/autoloop-core/isolation": `${CORE}/isolation/index.ts`,
      "@mobrienv/autoloop-core": `${CORE}/index.ts`,
      "@mobrienv/autoloop-dashboard": `${DASHBOARD}/app.ts`,
      "@mobrienv/autoloop-backends/acp-client": `${BACKENDS}/acp-client.ts`,
      "@mobrienv/autoloop-backends/acp-providers": `${BACKENDS}/acp-providers.ts`,
      "@mobrienv/autoloop-backends/claude-sdk-client": `${BACKENDS}/claude-sdk-client.ts`,
      "@mobrienv/autoloop-backends/pi-rpc-client": `${BACKENDS}/pi-rpc-client.ts`,
      "@mobrienv/autoloop-backends/run-command": `${BACKENDS}/run-command.ts`,
      "@mobrienv/autoloop-backends/types": `${BACKENDS}/types.ts`,
      "@mobrienv/autoloop-backends": `${BACKENDS}/index.ts`,
      "@mobrienv/autoloop-harness/backend/acp-client": `${HARNESS}/backend/acp-client.ts`,
      "@mobrienv/autoloop-harness/backend/kiro-bridge": `${HARNESS}/backend/kiro-bridge.ts`,
      "@mobrienv/autoloop-harness/backend/run-command": `${HARNESS}/backend/run-command.ts`,
      "@mobrienv/autoloop-harness/backend": `${HARNESS}/backend/index.ts`,
      "@mobrienv/autoloop-harness/wave/parse-objectives": `${HARNESS}/wave/parse-objectives.ts`,
      "@mobrienv/autoloop-harness/wave/launch-branches": `${HARNESS}/wave/launch-branches.ts`,
      "@mobrienv/autoloop-harness/wave/finalize-wave": `${HARNESS}/wave/finalize-wave.ts`,
      "@mobrienv/autoloop-harness/wave/types": `${HARNESS}/wave/types.ts`,
      "@mobrienv/autoloop-harness/wave": `${HARNESS}/wave.ts`,
      "@mobrienv/autoloop-harness/registry-bridge": `${HARNESS}/registry-bridge.ts`,
      "@mobrienv/autoloop-harness/suspend-state": `${HARNESS}/suspend-state.ts`,
      "@mobrienv/autoloop-harness/hooks": `${HARNESS}/hooks.ts`,
      "@mobrienv/autoloop-harness/pi-adapter": `${HARNESS}/pi-adapter.ts`,
      "@mobrienv/autoloop-harness/control/render": `${HARNESS}/control/render.ts`,
      "@mobrienv/autoloop-harness/control/types": `${HARNESS}/control/types.ts`,
      "@mobrienv/autoloop-harness/control/queue": `${HARNESS}/control/queue.ts`,
      "@mobrienv/autoloop-harness/control/capabilities": `${HARNESS}/control/capabilities.ts`,
      "@mobrienv/autoloop-harness/control/dispatch": `${HARNESS}/control/dispatch.ts`,
      "@mobrienv/autoloop-harness/control/paths": `${HARNESS}/control/paths.ts`,
      "@mobrienv/autoloop-harness/control/adapter": `${HARNESS}/control/adapter.ts`,
      "@mobrienv/autoloop-harness/control/kiro-adapter": `${HARNESS}/control/kiro-adapter.ts`,
      "@mobrienv/autoloop-harness/control/pi-adapter": `${HARNESS}/control/pi-adapter.ts`,
      "@mobrienv/autoloop-harness/control": `${HARNESS}/control/index.ts`,
      "@mobrienv/autoloop-harness/types": `${HARNESS}/types.ts`,
      "@mobrienv/autoloop-harness/events": `${HARNESS}/events.ts`,
      "@mobrienv/autoloop-harness/emit": `${HARNESS}/emit.ts`,
      "@mobrienv/autoloop-harness/ask": `${HARNESS}/ask.ts`,
      "@mobrienv/autoloop-harness/artifacts": `${HARNESS}/artifacts.ts`,
      "@mobrienv/autoloop-harness/config-helpers": `${HARNESS}/config-helpers.ts`,
      "@mobrienv/autoloop-harness/coordination": `${HARNESS}/coordination.ts`,
      "@mobrienv/autoloop-harness/display": `${HARNESS}/display.ts`,
      "@mobrienv/autoloop-harness/metrics": `${HARNESS}/metrics.ts`,
      "@mobrienv/autoloop-harness/guards": `${HARNESS}/guards.ts`,
      "@mobrienv/autoloop-harness/scratchpad": `${HARNESS}/scratchpad.ts`,
      "@mobrienv/autoloop-harness/metareview": `${HARNESS}/metareview.ts`,
      "@mobrienv/autoloop-harness/acceptance": `${HARNESS}/acceptance.ts`,
      "@mobrienv/autoloop-harness/postconditions": `${HARNESS}/postconditions.ts`,
      "@mobrienv/autoloop-harness/provisional": `${HARNESS}/provisional.ts`,
      "@mobrienv/autoloop-harness/tamper": `${HARNESS}/tamper.ts`,
      "@mobrienv/autoloop-harness/file-mod-audit": `${HARNESS}/file-mod-audit.ts`,
      "@mobrienv/autoloop-harness/git-diff": `${HARNESS}/git-diff.ts`,
      "@mobrienv/autoloop-harness/circuit-breaker": `${HARNESS}/circuit-breaker.ts`,
      "@mobrienv/autoloop-harness/intent": `${HARNESS}/intent.ts`,
      "@mobrienv/autoloop-harness/premature-quit": `${HARNESS}/premature-quit.ts`,
      "@mobrienv/autoloop-harness/progress": `${HARNESS}/progress.ts`,
      "@mobrienv/autoloop-harness/postfire-verify": `${HARNESS}/postfire-verify.ts`,
      "@mobrienv/autoloop-harness/completion-lint": `${HARNESS}/completion-lint.ts`,
      "@mobrienv/autoloop-harness/iteration-diff": `${HARNESS}/iteration-diff.ts`,
      "@mobrienv/autoloop-harness/parallel": `${HARNESS}/parallel.ts`,
      "@mobrienv/autoloop-harness/fanout-runner": `${HARNESS}/fanout-runner.ts`,
      "@mobrienv/autoloop-harness/iteration": `${HARNESS}/iteration.ts`,
      "@mobrienv/autoloop-harness/tools": `${HARNESS}/tools.ts`,
      "@mobrienv/autoloop-harness/prompt": `${HARNESS}/prompt.ts`,
      "@mobrienv/autoloop-harness": `${HARNESS}/index.ts`,
      "@mobrienv/autoloop-issue-sync-core": `${ISSUE_SYNC_CORE}/index.ts`,
      "@mobrienv/autoloop-gh-sync": `${GH_SYNC}/index.ts`,
      "@mobrienv/autoloop-linear-sync": `${LINEAR_SYNC}/index.ts`,
    },
  },
  test: {
    include: ["test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    // Hermetic env: isolate from the developer's global autoloop config + local TZ
    // so the suite is reproducible (see test/setup/hermetic-env.ts).
    setupFiles: ["./test/setup/hermetic-env.ts"],
    env: { TZ: "UTC" },
    // Integration tests under test/worktree and test/integration spawn git/node
    // subprocesses. Cap worker pool so subprocess-heavy tests don't starve each
    // other; bump testTimeout to absorb spiky CI/load.
    testTimeout: 60000,
    poolOptions: {
      threads: {
        maxThreads: 4,
      },
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "packages/*/src/**/*.ts"],
      exclude: [
        "src/testing/**",
        "src/**/types.ts",
        "packages/*/src/**/types.ts",
      ],
      // Per-package gates. Targets from docs/sdk-migration.md phase 2.8:
      //   core/harness aim for 90/90; cli ratchets upward each release.
      // Current floors are sized to present state + small buffer to block
      // regression while follow-on work raises each package toward target.
      thresholds: {
        "packages/core/src/**": {
          lines: 85,
          branches: 85,
          functions: 85,
        },
        "packages/harness/src/**": {
          lines: 40,
          branches: 70,
          functions: 50,
        },
        "packages/backends/src/**": {
          lines: 35,
          branches: 60,
          functions: 40,
        },
        "packages/dashboard/src/**": {
          lines: 50,
          branches: 70,
          functions: 60,
        },
        "packages/cli/src/**": {
          lines: 2,
          branches: 0,
          functions: 0,
        },
        "src/**": {
          lines: 95,
          branches: 95,
          functions: 95,
        },
      },
    },
  },
});
