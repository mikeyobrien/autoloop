import { describe, expect, it } from "vitest";
import { LinearAdapter } from "../src/adapter.js";

const RUN_CONTRACT = Boolean(process.env.LINEAR_SYNC_CONTRACT_TEST);

describe("LinearAdapter unit (no API call)", () => {
  it("throws without api key", () => {
    const savedKey = process.env.LINEAR_API_KEY;
    delete process.env.LINEAR_API_KEY;
    expect(() => new LinearAdapter({ apiKey: "" })).toThrow("LINEAR_API_KEY");
    process.env.LINEAR_API_KEY = savedKey;
  });

  it("is constructable with api key", () => {
    const adapter = new LinearAdapter({ apiKey: "fake-key-for-test" });
    expect(adapter).toBeDefined();
  });
});

(RUN_CONTRACT ? describe : describe.skip)(
  "LinearAdapter contract test (requires LINEAR_SYNC_CONTRACT_TEST=1 + LINEAR_API_KEY)",
  () => {
    it("lists issues from Todo state", async () => {
      const adapter = new LinearAdapter({
        apiKey: process.env.LINEAR_API_KEY ?? "",
      });
      const issues = await adapter.listIssues(["Todo"]);
      expect(Array.isArray(issues)).toBe(true);
    });
  },
);
