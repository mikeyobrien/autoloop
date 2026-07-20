import { describe, expect, it } from "vitest";
import config from "../../vitest.config.js";

describe("Vitest worker policy", () => {
  it("caps the selected forks pool while preserving file parallelism", () => {
    expect(config.test).toMatchObject({
      pool: "forks",
      maxWorkers: 4,
      fileParallelism: true,
    });
    expect(config.test?.poolOptions?.threads?.maxThreads).toBeUndefined();
  });
});
