import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Alias workspace packages to their source so vitest mocks of relative paths
// inside the source tree still apply. Otherwise consumers go through dist/
// and vi.mock("../src/foo.js") misses because the module id differs.
const CORE = resolve(import.meta.dirname, "packages/core/src");
const HARNESS = resolve(import.meta.dirname, "packages/harness/src");
const BACKENDS = resolve(import.meta.dirname, "packages/backends/src");
const DASHBOARD = resolve(import.meta.dirname, "packages/dashboard/src");

export default defineConfig({
  resolve: {
    alias: {
      "@mobrienv/autoloop-core/config-schema": `${CORE}/config-schema.ts`,
      "@mobrienv/autoloop-core/config": `${CORE}/config.ts`,
      "@mobrienv/autoloop-core/agent-map": `${CORE}/agent-map.ts`,
      "@mobrienv/autoloop-core/profiles": `${CORE}/profiles.ts`,
      "@mobrienv/autoloop-core/tasks-render": `${CORE}/tasks-render.ts`,
      "@mobrienv/autoloop-core/tasks": `${CORE}/tasks.ts`,
      "@mobrienv/autoloop-core/memory-render": `${CORE}/memory-render.ts`,
      "@mobrienv/autoloop-core/memory": `${CORE}/memory.ts`,
      "@mobrienv/autoloop-core/journal-format": `${CORE}/journal-format.ts`,
      "@mobrienv/autoloop-core/journal": `${CORE}/journal.ts`,
      "@mobrienv/autoloop-core/topology": `${CORE}/topology.ts`,
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
      "@mobrienv/autoloop-backends/run-command": `${BACKENDS}/run-command.ts`,
      "@mobrienv/autoloop-backends/types": `${BACKENDS}/types.ts`,
      "@mobrienv/autoloop-backends": `${BACKENDS}/index.ts`,
      "@mobrienv/autoloop-harness/backend/acp-client": `${HARNESS}/backend/acp-client.ts`,
      "@mobrienv/autoloop-harness/backend/kiro-bridge": `${HARNESS}/backend/kiro-bridge.ts`,
      "@mobrienv/autoloop-harness/backend/run-command": `${HARNESS}/backend/run-command.ts`,
      "@mobrienv/autoloop-harness/backend": `${HARNESS}/backend/index.ts`,
      "@mobrienv/autoloop-harness/wave/parse-objectives": `${HARNESS}/wave/parse-objectives.ts`,
      "@mobrienv/autoloop-harness/registry-bridge": `${HARNESS}/registry-bridge.ts`,
      "@mobrienv/autoloop-harness/pi-adapter": `${HARNESS}/pi-adapter.ts`,
      "@mobrienv/autoloop-harness/types": `${HARNESS}/types.ts`,
      "@mobrienv/autoloop-harness/events": `${HARNESS}/events.ts`,
      "@mobrienv/autoloop-harness/emit": `${HARNESS}/emit.ts`,
      "@mobrienv/autoloop-harness/artifacts": `${HARNESS}/artifacts.ts`,
      "@mobrienv/autoloop-harness/config-helpers": `${HARNESS}/config-helpers.ts`,
      "@mobrienv/autoloop-harness/coordination": `${HARNESS}/coordination.ts`,
      "@mobrienv/autoloop-harness/display": `${HARNESS}/display.ts`,
      "@mobrienv/autoloop-harness/metrics": `${HARNESS}/metrics.ts`,
      "@mobrienv/autoloop-harness/scratchpad": `${HARNESS}/scratchpad.ts`,
      "@mobrienv/autoloop-harness/metareview": `${HARNESS}/metareview.ts`,
      "@mobrienv/autoloop-harness/parallel": `${HARNESS}/parallel.ts`,
      "@mobrienv/autoloop-harness/iteration": `${HARNESS}/iteration.ts`,
      "@mobrienv/autoloop-harness/tools": `${HARNESS}/tools.ts`,
      "@mobrienv/autoloop-harness/prompt": `${HARNESS}/prompt.ts`,
      "@mobrienv/autoloop-harness": `${HARNESS}/index.ts`,
    },
  },
  test: {
    include: ["test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
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
