import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeEvent } from "@mobrienv/autoloop-core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ensureBuild,
  makeTempProject,
  readText,
  runCli,
} from "../helpers/runtime.js";

const TOPOLOGY = `name = "minimal"
completion = "task.complete"
[[role]]
id = "planner"
emits = ["step.done"]
prompt_file = "roles/planner.md"
[handoff]
"loop.start" = ["planner"]
"step.done" = ["planner"]
`;

const COMMON_OUTPUTS = ["one", "two", "three", "four", "five"];

interface JournalEvent {
  topic: string;
  iteration: string;
  fields: Record<string, string>;
  payload: string;
}

function readJournal(stateDir: string): JournalEvent[] {
  const text = readText(join(stateDir, "journal.jsonl"));
  const events: JournalEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const decoded = decodeEvent(trimmed);
    if (!decoded) continue;
    events.push({
      topic: decoded.topic,
      iteration: decoded.iteration ?? "",
      fields: decoded.shape === "fields" ? decoded.fields : {},
      payload: decoded.shape === "payload" ? decoded.payload : "",
    });
  }
  return events;
}

function fixturePath(project: string): string {
  return join(project, "mock-fixture.json");
}

function writeFixture(
  project: string,
  outputs: string[],
  emitEvent?: string,
): void {
  writeFileSync(
    fixturePath(project),
    JSON.stringify({
      output_by_iteration: outputs,
      emit_event: emitEvent,
      emit_payload: "progress",
    }),
    "utf-8",
  );
}

function runProject(
  project: string,
  extraEnv: Record<string, string> = {},
): { stdout: string; stderr: string; status: number | null } {
  return runCli(["run", project, "guard test"], {
    MOCK_FIXTURE_PATH: fixturePath(project),
    ...extraEnv,
  });
}

function stateDir(project: string): string {
  return join(project, ".autoloop");
}

function setupProject(
  noEventIterations?: number,
  stallIterations?: number,
): string {
  const project = makeTempProject("no-event-guard");
  writeFileSync(join(project, "topology.toml"), TOPOLOGY);
  if (noEventIterations !== undefined) {
    appendFileSync(
      join(project, "autoloops.toml"),
      `\nevent_loop.no_event_iterations = ${noEventIterations}\n`,
      "utf-8",
    );
  }
  if (stallIterations !== undefined) {
    appendFileSync(
      join(project, "autoloops.toml"),
      `\nevent_loop.stall_iterations = ${stallIterations}\n`,
      "utf-8",
    );
  }
  return project;
}

describe("no-event guard integration", () => {
  beforeAll(() => {
    ensureBuild();
  });

  it("stops with no_event after exactly no_event_iterations when outputs vary", () => {
    const project = setupProject(3, 2);
    writeFixture(project, COMMON_OUTPUTS);
    const res = runProject(project);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("stop:no_event");
    const events = readJournal(stateDir(project));
    const finishes = events.filter((e) => e.topic === "iteration.finish");
    expect(finishes).toHaveLength(3);
    expect(finishes.map((e) => e.fields.output ?? e.payload)).toEqual([
      "one",
      "two",
      "three",
    ]);
    const stop = events.find((e) => e.topic === "loop.stop");
    expect(stop).toBeDefined();
    expect(stop?.fields.reason ?? stop?.payload).toBe("no_event");
    expect(stop?.fields.completed_iterations).toBe("3");
    expect(stop?.fields.no_event_iterations).toBe("3");
    expect(stop?.fields.threshold).toBe("3");
  });

  it("does not trigger no_event when events are emitted each iteration", () => {
    const project = setupProject(3, 2);
    writeFixture(project, COMMON_OUTPUTS, "step.done");
    const res = runProject(project);
    expect(res.status).toBe(0);
    const events = readJournal(stateDir(project));
    const finishes = events.filter((e) => e.topic === "iteration.finish");
    expect(finishes).toHaveLength(5);
    const doneEvents = events.filter(
      (e) => e.topic === "step.done" && e.payload === "progress",
    );
    expect(doneEvents).toHaveLength(5);
    const stop = events.find((e) => e.topic === "loop.stop");
    expect(stop).toBeDefined();
    expect(stop?.fields.reason ?? stop?.payload).toBe("max_iterations");
  });

  it("defaults to disabled when no_event_iterations is not set", () => {
    const project = setupProject();
    writeFixture(project, COMMON_OUTPUTS);
    const res = runProject(project);
    expect(res.status).toBe(0);
    const events = readJournal(stateDir(project));
    const finishes = events.filter((e) => e.topic === "iteration.finish");
    expect(finishes).toHaveLength(5);
    const stop = events.find((e) => e.topic === "loop.stop");
    expect(stop).toBeDefined();
    expect(stop?.fields.reason ?? stop?.payload).toBe("max_iterations");
  });

  it("counts empty output as no-event and stops with no_event, not stalled", () => {
    const project = setupProject(3, 2);
    writeFixture(project, ["", "", "", "", ""]);
    const res = runProject(project);
    expect(res.status).toBe(0);
    const events = readJournal(stateDir(project));
    const finishes = events.filter((e) => e.topic === "iteration.finish");
    expect(finishes).toHaveLength(3);
    const stop = events.find((e) => e.topic === "loop.stop");
    expect(stop).toBeDefined();
    expect(stop?.fields.reason ?? stop?.payload).toBe("no_event");
    expect(stop?.fields.reason ?? stop?.payload).not.toBe("stalled");
  });

  it("ignores events for topics not in the topology emits list", () => {
    const project = setupProject(3, 2);
    writeFixture(project, COMMON_OUTPUTS, "bogus.not.allowed");
    const res = runProject(project);
    expect(res.status).toBe(0);
    const events = readJournal(stateDir(project));
    const finishes = events.filter((e) => e.topic === "iteration.finish");
    expect(finishes).toHaveLength(3);
    const stop = events.find((e) => e.topic === "loop.stop");
    expect(stop).toBeDefined();
    expect(stop?.fields.reason ?? stop?.payload).toBe("no_event");
    const invalid = events.filter((e) => e.topic === "event.invalid");
    expect(invalid.length).toBeGreaterThan(0);
  });
});
