import { normalizeBackendLabel } from "@mobrienv/autoloop-backends";
import { describe, expect, it } from "vitest";

describe("normalizeBackendLabel", () => {
  it("normalizes absolute claude paths to claude", () => {
    expect(normalizeBackendLabel("/opt/tools/claude")).toBe("claude");
  });

  it("normalizes absolute pi paths to pi", () => {
    expect(normalizeBackendLabel("/usr/local/bin/pi")).toBe("pi");
  });

  it("keeps generic commands readable", () => {
    expect(normalizeBackendLabel("node")).toBe("node");
    expect(normalizeBackendLabel("/usr/bin/env")).toBe("env");
  });
});
