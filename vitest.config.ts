import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Integration tests under test/worktree and test/integration spawn git/node
    // subprocesses; under parallel load the default 5s timeout is too tight.
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/testing/**", "src/**/types.ts"],
      thresholds: {
        lines: 50,
        branches: 75,
        functions: 60,
      },
    },
  },
});
