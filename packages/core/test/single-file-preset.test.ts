import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getInt,
  loadProjectFromFile,
  pathIsSingleFilePreset,
  resolvePresetSource,
} from "../src/config.js";
import { get } from "../src/config-schema.js";
import {
  isSingleFilePresetPath,
  loadTopologyFromFile,
  validateTopology,
} from "../src/topology.js";

const TMP_BASE = join(tmpdir(), `autoloop-single-file-preset-${process.pid}`);

function tmpDir(name: string): string {
  const dir = join(TMP_BASE, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writePreset(name: string, body: string): string {
  const dir = tmpDir(name);
  const file = join(dir, `${name}.toml`);
  writeFileSync(file, body, "utf-8");
  return file;
}

// A well-formed single-file preset: config tables and topology tables in one
// document, roles using inline prompts.
const GOOD_PRESET = `
name = "autoreview"
completion = "task.complete"

[event_loop]
max_iterations = 25
completion_event = "task.complete"

[backend]
kind = "command"
command = "claude"
timeout_ms = 600000

[memory]
prompt_budget_chars = 4000

[[role]]
id = "planner"
prompt = "You are the planner. Break the objective into review targets."
emits = ["targets.ready"]

[[role]]
id = "reviewer"
prompt = "You are the reviewer. Review each target and emit findings."
emits = ["review.ready", "review.blocked"]

[[role]]
id = "finalizer"
prompt = "You are the finalizer. Confirm the review is complete."
emits = ["task.complete"]

[handoff]
"loop.start" = ["planner"]
"targets.ready" = ["reviewer"]
"review.ready" = ["finalizer"]
"review.blocked" = ["planner"]
`;

beforeEach(() => mkdirSync(TMP_BASE, { recursive: true }));
afterEach(() => rmSync(TMP_BASE, { recursive: true, force: true }));

describe("single-file preset loader", () => {
  it("loads config tables from the merged file, defaults-backed", () => {
    const file = writePreset("autoreview", GOOD_PRESET);
    const cfg = loadProjectFromFile(file);

    // Values from the file.
    expect(getInt(cfg, "event_loop.max_iterations", 0)).toBe(25);
    expect(get(cfg, "backend.command", "")).toBe("claude");
    expect(getInt(cfg, "memory.prompt_budget_chars", 0)).toBe(4000);
    // A key not in the file still comes from defaults().
    expect(get(cfg, "event_loop.completion_promise", "")).toBe("LOOP_COMPLETE");
    expect(get(cfg, "core.state_dir", "")).toBe(".autoloop");
  });

  it("loads topology tables from the same merged file", () => {
    const file = writePreset("autoreview", GOOD_PRESET);
    const topo = loadTopologyFromFile(file);

    expect(topo.name).toBe("autoreview");
    expect(topo.completion).toBe("task.complete");
    expect(topo.roles.map((r) => r.id)).toEqual([
      "planner",
      "reviewer",
      "finalizer",
    ]);
    // Inline prompts are resolved (no prompt_file needed).
    expect(topo.roles[0].prompt).toContain("You are the planner");
    expect(topo.handoff["targets.ready"]).toEqual(["reviewer"]);
  });

  it("a well-formed single-file preset produces no validator warnings", () => {
    const file = writePreset("autoreview", GOOD_PRESET);
    const topo = loadTopologyFromFile(file);
    const warnings = validateTopology(topo, { singleFile: true });
    expect(warnings).toEqual([]);
  });

  it("config and topology halves read disjoint keys from one parse", () => {
    // The config loader must ignore topology tables and vice versa.
    const file = writePreset("autoreview", GOOD_PRESET);
    const cfg = loadProjectFromFile(file);
    // Topology-only top-level keys never leak into config accessors.
    expect(get(cfg, "name", "ABSENT")).toBe("ABSENT");
    expect(get(cfg, "completion", "ABSENT")).toBe("ABSENT");
  });
});

describe("single-file preset resolution", () => {
  it("recognizes an explicit .toml path as a file preset", () => {
    const file = writePreset("autoreview", GOOD_PRESET);
    expect(pathIsSingleFilePreset(file)).toBe(true);
    expect(isSingleFilePresetPath(file)).toBe(true);

    const source = resolvePresetSource(file, "/nonexistent-bundle-root");
    expect(source).toEqual({
      kind: "file",
      file,
      projectDir: join(TMP_BASE, "autoreview"),
    });
  });

  it("does not treat a directory or missing path as a single file", () => {
    expect(pathIsSingleFilePreset(TMP_BASE)).toBe(false);
    expect(pathIsSingleFilePreset(join(TMP_BASE, "missing.toml"))).toBe(false);
  });
});

describe("validateTopology — single-file structural checks", () => {
  it("flags prompt_file roles in single-file mode", () => {
    const file = writePreset(
      "needs-inline",
      `
name = "needs-inline"
completion = "task.complete"

[[role]]
id = "planner"
prompt_file = "roles/planner.md"
emits = ["task.complete"]

[handoff]
"loop.start" = ["planner"]
`,
    );
    const topo = loadTopologyFromFile(file);
    const warnings = validateTopology(topo, { singleFile: true });
    expect(
      warnings.some(
        (w) =>
          w.kind === "prompt-file-in-single-file" &&
          w.message.includes("planner"),
      ),
    ).toBe(true);
  });

  it("flags a completion event no role emits", () => {
    const topo = loadTopologyFromFile(
      writePreset(
        "no-complete",
        `
name = "no-complete"
completion = "task.complete"

[[role]]
id = "worker"
prompt = "work"
emits = ["work.done"]

[handoff]
"loop.start" = ["worker"]
"work.done" = ["worker"]
`,
      ),
    );
    const warnings = validateTopology(topo);
    expect(
      warnings.some(
        (w) =>
          w.kind === "completion-unreachable" &&
          w.message.includes("task.complete"),
      ),
    ).toBe(true);
  });

  it("flags a gate whose event is never emitted and whose blocked topic is unroutable", () => {
    const topo = loadTopologyFromFile(
      writePreset(
        "bad-gate",
        `
name = "bad-gate"
completion = "task.complete"

[[role]]
id = "worker"
prompt = "work"
emits = ["task.complete"]

[handoff]
"loop.start" = ["worker"]

[[gate]]
event = "verify.passed"
requires = ["tests"]
blocked = "verify.blocked"
`,
      ),
    );
    const warnings = validateTopology(topo);
    expect(warnings.some((w) => w.kind === "gate-dead-event")).toBe(true);
    expect(warnings.some((w) => w.kind === "gate-blocked-unroutable")).toBe(
      true,
    );
  });
});
