import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent } from "@mobrienv/autoloop-core/journal";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coreSystemTopic, routingTopic } from "../../src/emit.js";
import type { LoopEvent } from "../../src/events.js";
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
  it("announces a route without complexity or handoff and journals no handoff", async () => {
    const events: LoopEvent[] = [];
    loop.onEvent = (event) => events.push(event);
    await resolveJevRouting(loop);
    expect(events).toEqual([
      {
        type: "routing.selected",
        runId: "test",
        route: "bug-fix",
        reason: "choice",
        choice: "bug-fix",
        confidence: 0.95,
      },
    ]);
    expect(readFileSync(loop.paths.journalFile, "utf-8")).not.toContain(
      '"handoff"',
    );
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

describe("lane routing", () => {
  const laneRoutes = [
    {
      id: "bug-fix",
      description: "Repair incorrect existing behavior",
      instructions: "Reproduce, fix, verify.",
      handoff: { "plan.ready": ["builder-sol"] },
    },
    {
      id: "feature",
      description: "Add a new behavior",
      instructions: "Design, implement, verify.",
      handoff: { "plan.ready": ["builder-opus"] },
    },
    {
      id: "hard",
      description: "Escalated work",
      instructions: "Question the premise first.",
      handoff: {
        "plan.ready": ["builder-astra"],
        "review.rejected": ["planner"],
      },
    },
    {
      id: "unrouted",
      description: "Planner chooses",
      instructions: "Choose a plan.<lane> event yourself.",
    },
  ];
  const laneConfig: JevRoutingConfig = {
    model: "jev-1.13.0",
    timeoutMs: 1000,
    minConfidence: 0.8,
    routes: laneRoutes,
    fallbackRoute: "unrouted",
    complexity: { route: "hard", threshold: 1.5 },
  };
  function laneResponse(
    route: Record<string, unknown> = {},
    complexity: Record<string, unknown> = {},
  ) {
    return {
      model: "jev-1.13.0",
      answers: {
        route: {
          type: "choice",
          choice: "bug-fix",
          confidence: 0.95,
          probabilities: { "bug-fix": 0.96, feature: 0.03, no_match: 0.01 },
          ...route,
        },
        complexity: {
          type: "score",
          score: 0.6,
          confidence: 0.9,
          legend: { "0": "a", "1": "b", "2": "c" },
          probabilities: { "0": 0.45, "1": 0.5, "2": 0.05 },
          ...complexity,
        },
      },
      usage: { input_tokens: 300, output_tokens: 40 },
    };
  }
  function reply(value: unknown) {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(value)));
  }
  function topology() {
    return {
      handoff: { "plan.ready": ["builder-sol"], "review.rejected": ["critic"] },
      handoffKeys: ["plan.ready", "review.rejected"],
    };
  }
  function journalEvent() {
    return JSON.parse(
      readFileSync(loop.paths.journalFile, "utf-8").trim().split("\n")[0],
    );
  }
  beforeEach(() => {
    loop.jevRouting = laneConfig;
    loop.topology = topology() as unknown as LoopContext["topology"];
  });

  it("asks only for selectable routes plus a complexity score", async () => {
    reply(laneResponse());
    await resolveJevRouting(loop);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(Object.keys(body.questions.route.criteria)).toEqual([
      "bug-fix",
      "feature",
      "no_match",
    ]);
    expect(body.questions.complexity).toMatchObject({ type: "score" });
    expect(body.questions.complexity.criteria).toHaveLength(3);
  });

  it("routes the chosen lane and patches handoff targets for the run", async () => {
    reply(
      laneResponse({
        choice: "feature",
        probabilities: { "bug-fix": 0.02, feature: 0.97, no_match: 0.01 },
      }),
    );
    const prompt = await resolveJevRouting(loop);
    expect(prompt).toContain("Jev workflow route: feature");
    expect(loop.topology.handoff["plan.ready"]).toEqual(["builder-opus"]);
    expect(loop.topology.handoff["review.rejected"]).toEqual(["critic"]);
    expect(journalEvent().fields).toMatchObject({
      route: "feature",
      reason: "choice",
    });
  });

  it("announces the route once per run and journals its handoff", async () => {
    reply(
      laneResponse({
        choice: "feature",
        probabilities: { "bug-fix": 0.02, feature: 0.97, no_match: 0.01 },
      }),
    );
    const events: LoopEvent[] = [];
    loop.onEvent = (event) => events.push(event);
    await resolveJevRouting(loop);
    await resolveJevRouting(loop);
    expect(events).toEqual([
      {
        type: "routing.selected",
        runId: "test",
        route: "feature",
        reason: "choice",
        choice: "feature",
        confidence: 0.95,
        complexity: 0.6,
        handoff: { "plan.ready": ["builder-opus"] },
      },
    ]);
    expect(JSON.parse(journalEvent().fields.handoff)).toEqual({
      "plan.ready": ["builder-opus"],
    });
  });

  it("announces a decision replayed from the journal", async () => {
    reply(laneResponse());
    await resolveJevRouting(loop);
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const events: LoopEvent[] = [];
    await resolveJevRouting({ ...loop, onEvent: (e) => events.push(e) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "routing.selected",
      route: "bug-fix",
      handoff: { "plan.ready": ["builder-sol"] },
    });
  });

  it("escalates on complexity and adds new handoff keys idempotently", async () => {
    reply(
      laneResponse(
        {},
        { score: 1.8, probabilities: { "0": 0, "1": 0.2, "2": 0.8 } },
      ),
    );
    await resolveJevRouting(loop);
    loop.topology = topology() as unknown as LoopContext["topology"];
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const prompt = await resolveJevRouting(loop);
    await resolveJevRouting(loop);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(prompt).toContain("Jev workflow route: hard");
    expect(loop.topology.handoff["plan.ready"]).toEqual(["builder-astra"]);
    expect(loop.topology.handoff["review.rejected"]).toEqual(["planner"]);
    expect(loop.topology.handoffKeys).toEqual([
      "plan.ready",
      "review.rejected",
    ]);
    expect(journalEvent().fields).toMatchObject({
      route: "hard",
      reason: "complexity",
    });
  });

  it.each([
    { confidence: 0.4 },
    {
      choice: "no_match",
      probabilities: { "bug-fix": 0.1, feature: 0.1, no_match: 0.8 },
    },
  ])("falls back instead of stopping on %j", async (patch) => {
    reply(laneResponse(patch));
    const prompt = await resolveJevRouting(loop);
    expect(prompt).toContain("Jev workflow route: unrouted");
    expect(loop.topology.handoff["plan.ready"]).toEqual(["builder-sol"]);
    expect(journalEvent().fields).toMatchObject({
      route: "unrouted",
      reason: "fallback",
    });
  });

  it("still fails closed without a fallback route", async () => {
    loop.jevRouting = { ...laneConfig, fallbackRoute: undefined };
    reply(
      laneResponse({
        confidence: 0.4,
        probabilities: {
          "bug-fix": 0.6,
          feature: 0.2,
          unrouted: 0.1,
          no_match: 0.1,
        },
      }),
    );
    await expect(resolveJevRouting(loop)).rejects.toThrow(
      "below min_confidence",
    );
  });

  it("does not offer code-selected routes to Jev", async () => {
    reply(
      laneResponse({
        choice: "hard",
        probabilities: { "bug-fix": 0, feature: 0, hard: 1 },
      }),
    );
    await expect(resolveJevRouting(loop)).rejects.toThrow("unknown route");
  });

  it.each([
    { type: "choice" },
    { score: 2.5 },
    { score: "1" },
    { confidence: 1.2 },
    { probabilities: { "0": 0.5, "1": 0.5 } },
    { probabilities: { "0": 0.5, "1": 0.5, "3": 0 } },
    { probabilities: { "0": 0.5, "1": 0.6, "2": 0 } },
    { probabilities: { "0": 0.5, "1": 0.5, "2": "0" } },
  ])("fails closed on invalid complexity answers %j", async (patch) => {
    reply(laneResponse({}, patch));
    await expect(resolveJevRouting(loop)).rejects.toThrow("Jev routing:");
  });

  it("fails closed when the complexity answer is missing", async () => {
    const value = laneResponse();
    delete (value.answers as Record<string, unknown>).complexity;
    reply(value);
    await expect(resolveJevRouting(loop)).rejects.toThrow("Jev routing:");
  });
});

describe("lane routing configuration", () => {
  const catalog = [
    {
      id: "bug-fix",
      description: "d",
      instructions: "i",
      handoff: { "plan.ready": ["builder-sol"] },
    },
    { id: "hard", description: "d", instructions: "i" },
    { id: "unrouted", description: "d", instructions: "i" },
  ];
  function readLanes(
    overrides: Record<string, unknown> = {},
    routesFile: unknown = catalog,
    roleIds: string[] | null = ["builder-sol", "planner"],
  ) {
    writeFileSync(join(dir, "routes.json"), JSON.stringify(routesFile));
    return readJevRoutingConfig(
      {
        routing: {
          jev: { enabled: true, routes_file: "routes.json", ...overrides },
        },
      },
      dir,
      roleIds ?? undefined,
    );
  }

  it("reads handoff patches, fallback, and complexity escalation", () => {
    expect(
      readLanes({
        fallback_route: "unrouted",
        complexity_route: "hard",
        complexity_threshold: 1.2,
      }),
    ).toMatchObject({
      routes: [
        { id: "bug-fix", handoff: { "plan.ready": ["builder-sol"] } },
        { id: "hard" },
        { id: "unrouted" },
      ],
      fallbackRoute: "unrouted",
      complexity: { route: "hard", threshold: 1.2 },
    });
    expect(readLanes({ complexity_route: "hard" })?.complexity).toEqual({
      route: "hard",
      threshold: 1.5,
    });
    expect(readLanes()).not.toHaveProperty("fallbackRoute");
    expect(readLanes()).not.toHaveProperty("complexity");
  });

  it("skips role validation when no role list is supplied", () => {
    const routes = [{ ...catalog[0], handoff: { "plan.ready": ["anyone"] } }];
    expect(readLanes({}, routes, null)?.routes[0].handoff).toEqual({
      "plan.ready": ["anyone"],
    });
  });

  it.each([
    [{ fallback_route: "missing" }, catalog],
    [{ complexity_route: "missing" }, catalog],
    [{ complexity_route: "hard", complexity_threshold: 2.5 }, catalog],
    [{ complexity_route: "hard", complexity_threshold: "x" }, catalog],
    [{ fallback_route: "bug-fix" }, [catalog[0]]],
    [{}, [{ ...catalog[0], handoff: { "plan.ready": ["ghost"] } }]],
    [{}, [{ ...catalog[0], handoff: { "plan.ready": [] } }]],
    [{}, [{ ...catalog[0], handoff: { "plan.ready": "builder-sol" } }]],
    [{}, [{ ...catalog[0], handoff: [] }]],
  ])("rejects invalid lane configuration %j %j", (overrides, routesFile) => {
    expect(() => readLanes(overrides, routesFile)).toThrow("Jev routing:");
  });
});
