import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent } from "@mobrienv/autoloop-core/journal";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coreSystemTopic, routingTopic } from "../../src/emit.js";
import {
  type JevRoutingConfig,
  readJevRoutingConfig,
  resolveJevRouting,
} from "../../src/jev-routing.js";
import { routingEventFromLines } from "../../src/prompt.js";
import type { LoopContext } from "../../src/types.js";

const routes = [
  {
    id: "bug-fix",
    description: "Repair incorrect existing behavior",
    instructions: "Reproduce, fix, verify.",
  },
  {
    id: "feature",
    description: "Add a new behavior",
    instructions: "Design, implement, verify.",
  },
];
const config: JevRoutingConfig = {
  model: "jev-1.13.0",
  timeoutMs: 1000,
  minConfidence: 0.8,
  routes,
};
function response() {
  return {
    model: "jev-1.13.0",
    answers: {
      route: {
        type: "choice",
        choice: "bug-fix",
        confidence: 0.95,
        probabilities: { "bug-fix": 0.96, feature: 0.03, no_match: 0.01 },
      },
    },
    usage: { input_tokens: 200, output_tokens: 20 },
  };
}
let dir: string;
let loop: LoopContext;
const fetchMock = vi.fn();
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jev-routing-"));
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  loop = {
    objective: "Fix duplicated export rows",
    jevRouting: config,
    runtime: { runId: "test" },
    paths: { journalFile: join(dir, "journal.jsonl") },
  } as LoopContext;
  vi.stubEnv("TYPESAFE_API_KEY", "test-key-not-a-secret");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock
    .mockReset()
    .mockImplementation(async () => new Response(JSON.stringify(response())));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});
function read(overrides: Record<string, unknown> = {}) {
  return readJevRoutingConfig(
    {
      routing: {
        jev: { enabled: true, routes_file: "routes.json", ...overrides },
      },
    },
    dir,
  );
}

describe("opt-in configuration", () => {
  it("does not read routes or require a key while disabled", () => {
    expect(readJevRoutingConfig({}, "/not-present")).toBeUndefined();
    expect(read({ enabled: false, routes_file: "missing" })).toBeUndefined();
  });
  it("resolves preset-relative routes and explicit settings", () => {
    expect(read()).toEqual(configWithDefaults());
    expect(
      read({ timeout_ms: 7000, min_confidence: 0.9, model: "jev-latest" }),
    ).toMatchObject({
      timeoutMs: 7000,
      minConfidence: 0.9,
      model: "jev-latest",
    });
  });
  it.each([
    { enabled: "yes" },
    { routes_file: "" },
    { routes_file: "missing" },
    { timeout_ms: "oops" },
    { timeout_ms: "" },
    { min_confidence: " " },
    { timeout_ms: 0 },
    { timeout_ms: 60001 },
    { timeout_ms: 1.5 },
    { min_confidence: -1 },
    { min_confidence: 1.1 },
    { model: " " },
  ])("rejects invalid configuration %j", (override) => {
    expect(() => read(override)).toThrow("Jev routing:");
  });
  it.each([
    null,
    {},
    [],
    Array(65).fill(routes[0]),
    [null],
    [false],
    [[]],
    [routes[0], routes[0]],
    [{ ...routes[0], id: "no_match" }],
    [{ ...routes[0], id: "Bad ID" }],
    [{ ...routes[0], id: 2 }],
    [{ ...routes[0], description: " " }],
    [{ ...routes[0], instructions: null }],
  ])("rejects malformed route catalogs %j", (catalog) => {
    writeFileSync(join(dir, "routes.json"), JSON.stringify(catalog));
    expect(() => read()).toThrow("Jev routing:");
  });
  it("rejects broken JSON", () => {
    writeFileSync(join(dir, "routes.json"), "{");
    expect(() => read()).toThrow("cannot read");
  });
});
function configWithDefaults() {
  return { ...config, timeoutMs: 2000 };
}

describe("routing decisions", () => {
  it("disabled means no network, credentials, or journal access", async () => {
    loop.jevRouting = undefined;
    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect(await resolveJevRouting(loop)).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("selects only supplied instructions and replays a validated decision across resume", async () => {
    const prompt = await resolveJevRouting(loop);
    expect(prompt).toContain("Jev workflow route: bug-fix");
    expect(prompt).toContain(routes[0].instructions);
    expect(prompt).not.toContain(routes[1].instructions);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(options).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { Authorization: "Bearer test-key-not-a-secret" },
    });
    const body = JSON.parse(options.body);
    expect(body.state).toEqual({ objective: loop.objective });
    expect(body.questions.route.criteria.no_match).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain(routes[0].instructions);
    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect(await resolveJevRouting({ ...loop })).toBe(prompt);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const journal = readFileSync(loop.paths.journalFile, "utf-8");
    expect(journal).not.toContain("test-key-not-a-secret");
    expect(journal).not.toContain(loop.objective);
    expect(routingEventFromLines(journal.trim().split("\n"))).toBe(
      "loop.start",
    );
    expect(coreSystemTopic("routing.jev.selected")).toBe(true);
    expect(routingTopic("routing.jev.selected")).toBe(false);
  });
  it("invalidates decisions on objective, config, or run changes", async () => {
    await resolveJevRouting(loop);
    loop.objective = "Fix a different defect";
    await resolveJevRouting(loop);
    loop.jevRouting = { ...config, minConfidence: 0.9 };
    await resolveJevRouting(loop);
    loop.runtime.runId = "another-run";
    await resolveJevRouting(loop);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("never logs unvalidated provider fields", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ ...response(), secret: "provider-secret" }),
      ),
    );
    await resolveJevRouting(loop);
    expect(readFileSync(loop.paths.journalFile, "utf-8")).not.toContain(
      "provider-secret",
    );
  });
  it("rejects missing credentials before a request", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    await expect(resolveJevRouting(loop)).rejects.toThrow("TYPESAFE_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects oversized state without truncation or request", async () => {
    loop.objective = "x".repeat(64000);
    await expect(resolveJevRouting(loop)).rejects.toThrow(
      "exceeds 64000 bytes",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    401, 403, 429, 529,
  ])("does not retry or fall back on HTTP %s", async (status) => {
    fetchMock.mockResolvedValue(new Response("secret body", { status }));
    await expect(resolveJevRouting(loop)).rejects.toThrow(
      `HTTP ${status}; no fallback`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("sanitizes transport errors", async () => {
    fetchMock.mockRejectedValue(new Error("secret transport detail"));
    await expect(resolveJevRouting(loop)).rejects.toThrow(
      "provider request failed; no fallback",
    );
  });
  it("rejects non-JSON bodies", async () => {
    fetchMock.mockResolvedValue(new Response("not JSON"));
    await expect(resolveJevRouting(loop)).rejects.toThrow(
      "provider request failed",
    );
  });
  it.each([
    { type: "noul" },
    { choice: "not-allowed" },
    {
      choice: "no_match",
      probabilities: { "bug-fix": 0, feature: 0, no_match: 1 },
    },
    { confidence: 0.79 },
    { confidence: "0.99" },
    { confidence: 2 },
    { probabilities: { "bug-fix": 1 } },
    { probabilities: { "bug-fix": 0.9, feature: 0.9, no_match: 0.1 } },
    { probabilities: { "bug-fix": 0.1, feature: 0.9, no_match: 0 } },
    { probabilities: { "bug-fix": 0.9, feature: -0.1, no_match: 0.2 } },
    { probabilities: { "bug-fix": 0.9, other: 0.1, no_match: 0 } },
  ])("fails closed on invalid or uncertain answers %j", async (patch) => {
    const value = response();
    Object.assign(value.answers.route, patch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify(value)));
    await expect(resolveJevRouting(loop)).rejects.toThrow(
      "no fallback was attempted",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([
    null,
    {},
    { ...response(), model: "secret\nmodel" },
    { ...response(), usage: { input_tokens: 0.5, output_tokens: 1 } },
    { ...response(), answers: { route: null } },
  ])("rejects malformed responses %j", async (value) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(value)));
    await expect(resolveJevRouting(loop)).rejects.toThrow("Jev routing:");
  });
  it("does not silently replace corrupt persisted decisions", async () => {
    await resolveJevRouting(loop);
    const event = JSON.parse(readFileSync(loop.paths.journalFile, "utf-8"));
    appendEvent(
      loop.paths.journalFile,
      "test",
      "",
      event.topic,
      `"state_hash":${JSON.stringify(event.fields.state_hash)},"response":"broken"`,
    );
    await expect(resolveJevRouting(loop)).rejects.toThrow(
      "invalid persisted routing decision",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("revalidates cached answer semantics", async () => {
    await resolveJevRouting(loop);
    const event = JSON.parse(readFileSync(loop.paths.journalFile, "utf-8"));
    event.fields.response = JSON.stringify({
      ...response(),
      answers: { route: { ...response().answers.route, confidence: 0.1 } },
    });
    writeFileSync(loop.paths.journalFile, JSON.stringify(event));
    await expect(resolveJevRouting(loop)).rejects.toThrow(
      "below min_confidence",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("cancels an in-flight request and its deadline covers body reads", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (_url, options) => ({
      ok: true,
      json: () =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        ),
    }));
    const result = expect(resolveJevRouting(loop)).rejects.toThrow(
      "timed out or was cancelled",
    );
    await vi.advanceTimersByTimeAsync(config.timeoutMs);
    await result;
  });
  it("propagates cancellation from the run", async () => {
    const controller = new AbortController();
    loop.signal = controller.signal;
    fetchMock.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        ),
    );
    const result = expect(resolveJevRouting(loop)).rejects.toThrow("cancelled");
    controller.abort();
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(resolveJevRouting(loop)).rejects.toThrow("cancelled");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
