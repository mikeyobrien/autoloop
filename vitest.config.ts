import { defineConfig } from "vitest/config";

export default defineConfig({
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
