import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Alias workspace packages to their source so vitest mocks of relative paths
// inside the source tree still apply. Otherwise consumers go through dist/
// and vi.mock("../src/foo.js") misses because the module id differs.
const CORE = resolve(import.meta.dirname, "packages/core/src");
const HARNESS = resolve(import.meta.dirname, "packages/harness/src");

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
      "@mobrienv/autoloop-core/worktree": `${CORE}/worktree/index.ts`,
      "@mobrienv/autoloop-core/isolation/resolve": `${CORE}/isolation/resolve.ts`,
      "@mobrienv/autoloop-core/isolation/run-scope": `${CORE}/isolation/run-scope.ts`,
      "@mobrienv/autoloop-core/isolation": `${CORE}/isolation/index.ts`,
      "@mobrienv/autoloop-core": `${CORE}/index.ts`,
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
      thresholds: {
        lines: 50,
        branches: 75,
        functions: 60,
      },
    },
  },
});
