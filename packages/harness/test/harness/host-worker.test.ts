import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRun } from "@mobrienv/autoloop-core/registry/read";
import { resume, run } from "@mobrienv/autoloop-harness";
import { buildLoopContext } from "@mobrienv/autoloop-harness/config-helpers";
import {
  type EmitResult,
  type HostTurn,
  type HostTurnResult,
  type HostWorker,
  runHostIteration,
} from "@mobrienv/autoloop-harness/host";
import { buildIterationContext } from "@mobrienv/autoloop-harness/prompt";
import { describe, expect, it } from "vitest";

const PLANNER_PROMPT =
  "You are the planner.\n\nWrite the plan in three numbered steps.\nThen hand off with plan.ready.";

const BASE_CONFIG = `event_loop.max_iterations = 4
event_loop.completion_event = "task.complete"
review.enabled = false
backend.kind = "command"
backend.command = "false"
`;

const BASE_TOPOLOGY = `name = "duo"
completion = "task.complete"

[[role]]
id = "planner"
emits = ["plan.ready"]
prompt_file = "roles/planner.md"

[[role]]
id = "builder"
emits = ["task.complete"]
prompt = "You are the builder."

[handoff]
"loop.start" = ["planner"]
"plan.ready" = ["builder"]
`;

const HINT = "Call the `autoloop_emit` tool with {topic, payload}.";

function makePreset(config = BASE_CONFIG, topology = BASE_TOPOLOGY): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-host-"));
  writeFileSync(join(dir, "autoloops.toml"), config);
  writeFileSync(join(dir, "topology.toml"), topology);
  mkdirSync(join(dir, "roles"));
  writeFileSync(join(dir, "roles", "planner.md"), PLANNER_PROMPT);
  return dir;
}

type Step = (turn: HostTurn) => HostTurnResult | Promise<HostTurnResult>;

interface ScriptedHost extends HostWorker {
  turns: HostTurn[];
  maxActive: number;
}

function scriptedHost(steps: Step[]): ScriptedHost {
  let active = 0;
  const host: ScriptedHost = {
    label: "host:test",
    eventToolHint: HINT,
    turns: [],
    maxActive: 0,
    async runTurn(turn) {
      active++;
      host.maxActive = Math.max(host.maxActive, active);
      host.turns.push(turn);
      try {
        await new Promise((r) => setTimeout(r, 2));
        const step = steps[host.turns.length - 1];
        if (!step) throw new Error(`no scripted step ${host.turns.length}`);
        return await step(turn);
      } finally {
        active--;
      }
    },
  };
  return host;
}

function emitting(topic: string, payload = "done"): Step {
  return (turn) => {
    const result = turn.emit(topic, payload);
    if (!result.ok) throw new Error(`emit ${topic} rejected: ${result.error}`);
    return { status: "completed", output: `emitted ${topic}` };
  };
}

function waitForAbort(turn: HostTurn): Promise<HostTurnResult> {
  return new Promise((resolve) => {
    turn.signal.addEventListener("abort", () =>
      resolve({ status: "interrupted", output: "stopped mid-turn" }),
    );
  });
}

interface JournalLine {
  run: string;
  iteration?: string;
  topic: string;
  fields?: Record<string, unknown>;
  payload?: string;
}

function journal(dir: string): JournalLine[] {
  const path = join(dir, ".autoloop", "journal.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as JournalLine);
}

function topics(dir: string): string[] {
  return journal(dir).map((l) => l.topic);
}

function runHost(dir: string, host: HostWorker, signal?: AbortSignal) {
  return run(dir, "Ship the feature", "autoloop", {
    workDir: dir,
    host,
    signal,
  });
}

describe("host worker run", () => {
  it("drives a two-role preset to task.complete with one turn at a time", async () => {
    const dir = makePreset();
    const host = scriptedHost([
      emitting("plan.ready"),
      emitting("task.complete"),
    ]);

    const summary = await runHost(dir, host);

    expect(summary.stopReason).toBe("completion_event");
    expect(summary.iterations).toBe(2);
    expect(host.maxActive).toBe(1);
    expect(
      host.turns.map((t) => ({
        iteration: t.iteration,
        recentEvent: t.recentEvent,
        roles: t.roles,
        allowedEvents: t.allowedEvents,
      })),
    ).toEqual([
      {
        iteration: 1,
        recentEvent: "loop.start",
        roles: [{ id: "planner", prompt: PLANNER_PROMPT }],
        allowedEvents: ["plan.ready"],
      },
      {
        iteration: 2,
        recentEvent: "plan.ready",
        roles: [{ id: "builder", prompt: "You are the builder." }],
        allowedEvents: ["task.complete"],
      },
    ]);
    const backendStart = journal(dir).find((l) => l.topic === "backend.start");
    expect(backendStart?.fields?.backend_kind).toBe("host");
    expect(backendStart?.fields?.command).toBe("host:test");
    expect(
      journal(dir).find((l) => l.topic === "loop.start")?.fields?.backend,
    ).toBe("host:test");
    expect(existsSync(join(dir, ".autoloop", "pi-adapter"))).toBe(false);
  });

  it("journals exactly the prompt the host receives, with full role text and the tool hint", async () => {
    const dir = makePreset();
    const host = scriptedHost([
      emitting("plan.ready"),
      emitting("task.complete"),
    ]);

    await runHost(dir, host);

    const journaled = journal(dir)
      .filter((l) => l.topic === "iteration.start")
      .map((l) => l.fields?.prompt);
    expect(journaled).toEqual(host.turns.map((t) => t.prompt));
    const first = host.turns[0].prompt;
    expect(first).toContain(`## Active role: planner\n${PLANNER_PROMPT}\n\n`);
    expect(first).toContain(`Event tool: ${HINT}\n`);
    expect(first).not.toContain("emit wait.request");
    expect(first).not.toContain("To park this run");
  });

  it("lets the host re-emit in the same turn after a routing rejection", async () => {
    const dir = makePreset();
    let rejected: EmitResult | undefined;
    let accepted: EmitResult | undefined;
    const host = scriptedHost([
      (turn) => {
        rejected = turn.emit("task.complete", "too early");
        accepted = turn.emit("plan.ready", "plan written");
        return { status: "completed", output: "planned" };
      },
      emitting("task.complete"),
    ]);

    const summary = await runHost(dir, host);

    expect(rejected).toEqual({
      ok: false,
      topic: "task.complete",
      error:
        "invalid event `task.complete`; recent event: `loop.start`; suggested roles: planner; allowed next events: plan.ready",
    });
    expect(accepted).toEqual({ ok: true, topic: "plan.ready" });
    expect(summary.stopReason).toBe("completion_event");
    expect(
      journal(dir)
        .filter((l) => l.iteration === "1")
        .map((l) => l.topic)
        .filter((t) => t === "event.invalid" || t === "plan.ready"),
    ).toEqual(["event.invalid", "plan.ready"]);
  });

  it("rejects fan-out, wait, and ask topics with a host-mode reason", async () => {
    const dir = makePreset();
    const results: EmitResult[] = [];
    const host = scriptedHost([
      (turn) => {
        results.push(turn.emit("plan.ready.parallel", "- a\n- b"));
        results.push(turn.emit("wait.request", "reason=nap"));
        results.push(turn.emit("human.ask", "which db?"));
        results.push(turn.emit("plan.ready", "plan"));
        return { status: "completed", output: "" };
      },
      emitting("task.complete"),
    ]);

    await runHost(dir, host);

    expect(results.map((r) => r.error ?? "ok")).toEqual([
      "`plan.ready.parallel` is not supported in host mode: parallel fan-out would launch another worker",
      "`wait.request` is not supported in host mode: the run cannot park without a live session",
      "`human.ask` is not supported in host mode: ask the operator in the conversation instead",
      "ok",
    ]);
  });

  it("runs the loop's pre_emit hooks and lets them rewrite the topic", async () => {
    const dir = makePreset(
      `${BASE_CONFIG}
[[hook]]
phase = "pre_emit"
command = "sh rewrite.sh"
mutate = "event"
`,
    );
    writeFileSync(
      join(dir, "rewrite.sh"),
      `[ "$AUTOLOOP_EMIT_TOPIC" = plan.draft ] && echo '{"topic":"plan.ready"}'\nexit 0\n`,
    );
    let result: EmitResult | undefined;
    const host = scriptedHost([
      (turn) => {
        result = turn.emit("plan.draft", "plan");
        return { status: "completed", output: "" };
      },
      emitting("task.complete"),
    ]);

    const summary = await runHost(dir, host);

    expect(result).toEqual({ ok: true, topic: "plan.ready" });
    expect(summary.stopReason).toBe("completion_event");
  });

  it("suspends the run when a post_emit hook fails with on_error=suspend", async () => {
    const dir = makePreset(
      `${BASE_CONFIG}
[[hook]]
phase = "post_emit"
command = "echo nope >&2; exit 3"
on_error = "suspend"
`,
    );
    let result: EmitResult | undefined;
    const host = scriptedHost([
      (turn) => {
        result = turn.emit("plan.ready", "plan");
        return { status: "completed", output: "" };
      },
    ]);

    const summary = await runHost(dir, host);

    expect(result).toEqual({
      ok: false,
      topic: "plan.ready",
      error: "hook post_emit failed (exit 3): nope",
    });
    expect(summary.stopReason).toBe("suspended");
    expect(host.turns).toHaveLength(1);
  });

  it("journals host usage as backend.usage", async () => {
    const dir = makePreset();
    const host = scriptedHost([
      (turn) => {
        turn.emit("plan.ready", "plan");
        return {
          status: "completed",
          output: "",
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 5,
            cacheWriteTokens: 1,
            costUsd: 0.25,
          },
        };
      },
      emitting("task.complete"),
    ]);

    await runHost(dir, host);

    const usage = journal(dir).filter((l) => l.topic === "backend.usage");
    expect(usage.map((l) => ({ iteration: l.iteration, ...l.fields }))).toEqual(
      [
        {
          iteration: "1",
          input_tokens: 100,
          output_tokens: 20,
          cache_read_tokens: 5,
          cache_write_tokens: 1,
          total_tokens: 126,
          cost_usd: 0.25,
        },
      ],
    );
  });

  it("stops as backend_failed when the host reports an error", async () => {
    const dir = makePreset();
    const host = scriptedHost([
      () => ({ status: "error", output: "model exploded" }),
    ]);

    const summary = await runHost(dir, host);

    expect(summary.stopReason).toBe("backend_failed");
    const finish = journal(dir).find((l) => l.topic === "backend.finish");
    expect(finish?.fields?.exit_code).toBe("1");
  });

  it("aborts the turn signal on run stop and stops as interrupted", async () => {
    const dir = makePreset();
    const controller = new AbortController();
    const host = scriptedHost([
      (turn) => {
        const stopped = waitForAbort(turn);
        controller.abort();
        return stopped;
      },
    ]);

    const summary = await runHost(dir, host, controller.signal);

    expect(summary.stopReason).toBe("interrupted");
    expect(host.turns[0].signal.aborted).toBe(true);
    const stop = journal(dir).find((l) => l.topic === "loop.stop");
    expect(stop?.fields?.reason).toBe("interrupted");
    expect(stop?.fields?.detail).toBe("operator interrupt");
  });

  it("aborts the turn at the iteration deadline and stops as backend_timeout", async () => {
    const dir = makePreset(`${BASE_CONFIG}backend.timeout_ms = 30\n`);
    const host = scriptedHost([waitForAbort]);

    const summary = await runHost(dir, host);

    expect(summary.stopReason).toBe("backend_timeout");
    const finish = journal(dir).find((l) => l.topic === "backend.finish");
    expect(finish?.fields?.timed_out).toBe(true);
  });

  it("resumes a host run on the same run id", async () => {
    const dir = makePreset(
      BASE_CONFIG.replace("max_iterations = 4", "max_iterations = 1"),
    );
    const first = await runHost(dir, scriptedHost([emitting("plan.ready")]));
    expect(first.stopReason).toBe("max_iterations");

    const record = getRun(
      join(dir, ".autoloop", "registry.jsonl"),
      first.runId ?? "",
    );
    if (!record) throw new Error("run not registered");
    const host = scriptedHost([emitting("task.complete")]);
    const resumed = await resume(record, {
      host,
      addIterations: 1,
      selfCommand: "autoloop",
    });

    expect(resumed.stopReason).toBe("completion_event");
    expect(resumed.resumedFromIteration).toBe(2);
    expect(host.turns.map((t) => [t.runId, t.iteration])).toEqual([
      [first.runId, 2],
    ]);
  });

  it("enforces a single-file preset's evidence gate on host emits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autoloop-host-single-"));
    const presetFile = join(dir, "gated.toml");
    writeFileSync(
      presetFile,
      `name = "gated"
completion = "task.complete"

[event_loop]
max_iterations = 2
completion_event = "task.complete"

[review]
enabled = false

[backend]
kind = "command"
command = "false"

[[role]]
id = "builder"
prompt = "Build and prove it."
emits = ["task.complete"]

[[gate]]
event = "task.complete"
requires = ["tests"]

[handoff]
"loop.start" = ["builder"]
`,
    );
    const results: EmitResult[] = [];
    const host = scriptedHost([
      (turn) => {
        results.push(turn.emit("task.complete", "done"));
        results.push(turn.emit("task.complete", "tests=pass"));
        return { status: "completed", output: "" };
      },
    ]);

    const summary = await run(dir, "Build", "autoloop", {
      workDir: dir,
      presetFile,
      host,
    });

    expect(results).toEqual([
      {
        ok: false,
        topic: "task.complete",
        error:
          "`task.complete` requires evidence tests; missing: tests. Emitted `task.blocked` instead. Include the evidence in the payload (e.g. `key=value`) and emit `task.complete` again.",
      },
      { ok: true, topic: "task.complete" },
    ]);
    expect(summary.stopReason).toBe("completion_event");
  });
});

describe("host preflight", () => {
  const stageTopology = `${BASE_TOPOLOGY}
[[stage]]
id = "vote"
trigger = "plan.ready"
role = "builder"
branches = 2
`;
  const cases: Array<[string, string, string, string]> = [
    [
      "metareview",
      BASE_CONFIG.replace("review.enabled = false", "review.enabled = true"),
      BASE_TOPOLOGY,
      "metareview is enabled",
    ],
    [
      "parallel",
      `${BASE_CONFIG}parallel.enabled = true\n`,
      BASE_TOPOLOGY,
      "parallel.enabled is true",
    ],
    ["stages", BASE_CONFIG, stageTopology, "topology declares fan-out stages"],
    [
      "concurrency",
      BASE_CONFIG,
      BASE_TOPOLOGY.replace(
        'prompt = "You are the builder."',
        'prompt = "You are the builder."\nconcurrency = 2',
      ),
      "role `builder` has concurrency 2",
    ],
  ];

  it.each(
    cases,
  )("refuses %s before loop.start is journaled", async (_name, config, topology, problem) => {
    const dir = makePreset(config, topology);
    const host = scriptedHost([]);

    await expect(runHost(dir, host)).rejects.toThrow(
      `host worker cannot run preset \`${dir.split("/").pop()}\`: ${problem}`,
    );
    expect(topics(dir)).not.toContain("loop.start");
    expect(host.turns).toEqual([]);
  });

  it("accepts a review-enabled preset when the caller overrides review off", async () => {
    const dir = makePreset(
      BASE_CONFIG.replace("review.enabled = false", "review.enabled = true"),
    );
    const summary = await run(dir, "Ship", "autoloop", {
      workDir: dir,
      host: scriptedHost([emitting("plan.ready"), emitting("task.complete")]),
      configOverride: { review: { enabled: false } },
    });
    expect(summary.stopReason).toBe("completion_event");
  });
});

describe("runHostIteration", () => {
  function liveIteration(config = BASE_CONFIG) {
    const dir = makePreset(config);
    const loop = buildLoopContext(dir, "Ship", "autoloop", { workDir: dir });
    return { loop, iter: buildIterationContext(loop, 1) };
  }

  it("hands an already-stopped run an aborted turn signal", async () => {
    const { loop, iter } = liveIteration();
    const controller = new AbortController();
    controller.abort();
    loop.signal = controller.signal;
    loop.host = scriptedHost([
      (turn) => ({
        status: turn.signal.aborted ? "interrupted" : "completed",
        output: "",
      }),
    ]);

    expect(await runHostIteration(loop, iter)).toEqual({
      output: "",
      exitCode: 130,
      timedOut: false,
      interrupted: true,
    });
  });

  it("sets no deadline when backend.timeout_ms is 0", async () => {
    const { loop, iter } = liveIteration(
      `${BASE_CONFIG}backend.timeout_ms = 0\n`,
    );
    const host = scriptedHost([
      async (turn) => {
        await new Promise((r) => setTimeout(r, 20));
        return { status: "completed", output: String(turn.signal.aborted) };
      },
    ]);
    loop.host = host;

    expect(await runHostIteration(loop, iter)).toEqual({
      output: "false",
      exitCode: 0,
      timedOut: false,
      interrupted: false,
    });
  });

  it("refuses to run without a host", async () => {
    const { loop, iter } = liveIteration();
    await expect(runHostIteration(loop, iter)).rejects.toThrow(
      "runHostIteration called without loop.host",
    );
  });
});

describe("iteration prompt tail", () => {
  function promptTail(host?: HostWorker): { prompt: string; tool: string } {
    const dir = makePreset();
    const loop = buildLoopContext(dir, "Ship", "autoloop", { workDir: dir });
    loop.host = host;
    const prompt = buildIterationContext(loop, 1).prompt;
    return {
      prompt: prompt.slice(prompt.indexOf("Event tool: ")),
      tool: loop.paths.toolPath,
    };
  }

  it("keeps the shell emit instructions byte-identical without a host", () => {
    const { prompt, tool } = promptTail();
    expect(prompt).toBe(
      `Event tool: ${tool}\n\n` +
        "Current scratchpad:\n(empty)\n\n" +
        "Use the event tool to publish your allowed handoff or completion event.\n" +
        "Examples:\n" +
        `${tool} emit <allowed-topic> "brief handoff summary"\n` +
        `${tool} emit task.complete "brief completion summary"\n` +
        `${tool} emit wait.request "reason=nap; duration=300s"\n` +
        `${tool} memory add learning "durable lesson"\n` +
        `${tool} memory add preference Workflow "short preference note"\n` +
        `${tool} task add "description of work item"\n` +
        `${tool} task complete task-1\n\n` +
        "Backpressure rule: if you emit an event outside the allowed next-event set, the loop will reject that handoff and ask you to re-route.\n" +
        `Prompt/output/scratchpad/memory are projections or stores you can inspect with \`${tool} inspect prompt 1 --format md\`, \`${tool} inspect scratchpad --format md\`, and \`${tool} inspect memory --format md\`.\n` +
        "Plain text alone does not publish an event. Prefer the event tool over the stdout completion promise.\n" +
        "To park this run without a live backend (same run_id, process exits 0), emit `wait.request`. Resume later with `autoloop resume <run-id>`. Do not sleep or backoff in-process — that burns backend.timeout_ms.\n",
    );
  });

  it("swaps in the host tool hint and drops shell emit and park lines", () => {
    const { prompt, tool } = promptTail(scriptedHost([]));
    expect(prompt).toBe(
      `Event tool: ${HINT}\n\n` +
        "Current scratchpad:\n(empty)\n\n" +
        "Use the event tool to publish your allowed handoff or completion event.\n" +
        "Memory and task commands:\n" +
        `${tool} memory add learning "durable lesson"\n` +
        `${tool} memory add preference Workflow "short preference note"\n` +
        `${tool} task add "description of work item"\n` +
        `${tool} task complete task-1\n\n` +
        "Backpressure rule: if you emit an event outside the allowed next-event set, the loop will reject that handoff and ask you to re-route.\n" +
        `Prompt/output/scratchpad/memory are projections or stores you can inspect with \`${tool} inspect prompt 1 --format md\`, \`${tool} inspect scratchpad --format md\`, and \`${tool} inspect memory --format md\`.\n` +
        "Plain text alone does not publish an event. Prefer the event tool over the stdout completion promise.\n",
    );
  });
});
