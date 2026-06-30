import {
  type BackendErrorClass,
  classifyBackendError,
  isRetryableErrorClass,
} from "@mobrienv/autoloop-backends";
import { describe, expect, it } from "vitest";

describe("classifyBackendError", () => {
  const cases: Array<[string, BackendErrorClass]> = [
    ["HTTP 429 Too Many Requests", "rate_limited"],
    ["Error: rate limit exceeded, please slow down", "rate_limited"],
    ["overloaded_error: server is temporarily overloaded", "transient_error"],
    ["please retry-after 30s", "rate_limited"],
    [
      "You exceeded your current quota, check your plan and billing",
      "quota_exhausted",
    ],
    ["insufficient_credits: balance too low", "quota_exhausted"],
    ["402 Payment Required", "quota_exhausted"],
    ["401 Unauthorized", "auth_failed"],
    ["Error 403: Forbidden", "auth_failed"],
    ["invalid api key provided", "auth_failed"],
    ["authentication failed for the request", "auth_failed"],
    ["503 Service Unavailable", "transient_error"],
    ["upstream 529 overloaded", "transient_error"],
    ["read ECONNRESET", "transient_error"],
    ["socket hang up", "transient_error"],
    ["gateway timeout while contacting model", "transient_error"],
    ["TypeError: cannot read property 'x' of undefined", "none"],
    ["", "none"],
  ];

  for (const [text, expected] of cases) {
    it(`classifies ${JSON.stringify(text.slice(0, 40))} → ${expected}`, () => {
      expect(classifyBackendError(text)).toBe(expected);
    });
  }

  it("prefers the more specific class (429 over generic 5xx text)", () => {
    expect(
      classifyBackendError("429 too many requests; service overloaded"),
    ).toBe("rate_limited");
  });

  it("prefers quota over auth when both appear", () => {
    expect(classifyBackendError("quota exceeded; also unauthorized")).toBe(
      "quota_exhausted",
    );
  });
});

describe("isRetryableErrorClass", () => {
  it("marks rate-limit and transient as retryable", () => {
    expect(isRetryableErrorClass("rate_limited")).toBe(true);
    expect(isRetryableErrorClass("transient_error")).toBe(true);
  });
  it("marks auth/quota/none as non-retryable", () => {
    expect(isRetryableErrorClass("auth_failed")).toBe(false);
    expect(isRetryableErrorClass("quota_exhausted")).toBe(false);
    expect(isRetryableErrorClass("none")).toBe(false);
  });
});
