import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
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
