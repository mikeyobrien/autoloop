import { describe, expect, it } from "vitest";
import {
  hooksForPhase,
  isSuspendState,
  parseHookSpecs,
  SUSPEND_STATE_SCHEMA_VERSION,
  validateHookSpecs,
} from "../src/hooks-schema.js";

describe("hooks-schema: parseHookSpecs", () => {
  it("parses legacy flat [hooks] keys as warn/none specs", () => {
    const raw = {
      hooks: {
        pre_run: "echo pre",
        pre_iteration: "echo pre-iter",
        post_iteration: "echo post-iter",
        post_run: "echo post",
      },
    };
    const specs = parseHookSpecs(raw);
    expect(specs).toHaveLength(4);
    for (const spec of specs) {
      expect(spec.onError).toBe("warn");
      expect(spec.mutate).toBe("none");
      expect(spec.source).toBe("legacy");
    }
    expect(hooksForPhase(specs, "pre_run")[0].command).toBe("echo pre");
  });

  it("upgrades legacy pre_run to block when strict=true", () => {
    const raw = { hooks: { pre_run: "exit 1", strict: "true" } };
    const specs = parseHookSpecs(raw);
    expect(specs).toHaveLength(1);
    expect(specs[0].onError).toBe("block");
  });

  it("strict=true does not affect other legacy phases", () => {
    const raw = {
      hooks: { pre_iteration: "echo hi", strict: true },
    };
    const specs = parseHookSpecs(raw);
    expect(specs[0].onError).toBe("warn");
  });

  it("parses [[hook]] array-of-tables entries with defaults", () => {
    const raw = {
      hook: [{ phase: "pre_iteration", command: "echo hi" }],
    };
    const specs = parseHookSpecs(raw);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      phase: "pre_iteration",
      command: "echo hi",
      onError: "warn",
      mutate: "none",
      source: "hook[0]",
    });
  });

  it("parses explicit on_error and mutate on [[hook]] entries", () => {
    const raw = {
      hook: [
        {
          phase: "pre_iteration",
          command: "echo hi",
          on_error: "suspend",
          mutate: "prompt",
        },
      ],
    };
    const specs = parseHookSpecs(raw);
    expect(specs[0].onError).toBe("suspend");
    expect(specs[0].mutate).toBe("prompt");
  });

  it("merges legacy + [[hook]] entries, legacy first, in phase order", () => {
    const raw = {
      hooks: { pre_run: "echo legacy-pre" },
      hook: [{ phase: "pre_run", command: "echo extra-pre" }],
    };
    const specs = parseHookSpecs(raw);
    const preRun = hooksForPhase(specs, "pre_run");
    expect(preRun.map((s) => s.command)).toEqual([
      "echo legacy-pre",
      "echo extra-pre",
    ]);
  });

  it("ignores [[hook]] entries with unknown phase or empty command", () => {
    const raw = {
      hook: [
        { phase: "bogus_phase", command: "echo hi" },
        { phase: "pre_run", command: "" },
        { phase: "pre_run" },
      ],
    };
    expect(parseHookSpecs(raw)).toHaveLength(0);
  });

  it("returns no specs for an empty/absent config", () => {
    expect(parseHookSpecs({})).toHaveLength(0);
  });

  it("hooksForPhase filters and preserves order", () => {
    const raw = {
      hook: [
        { phase: "pre_iteration", command: "a" },
        { phase: "post_iteration", command: "b" },
        { phase: "pre_iteration", command: "c" },
      ],
    };
    const specs = parseHookSpecs(raw);
    expect(hooksForPhase(specs, "pre_iteration").map((s) => s.command)).toEqual(
      ["a", "c"],
    );
  });
});

describe("hooks-schema: validateHookSpecs", () => {
  it("returns no errors for a well-formed [[hook]] table", () => {
    const raw = {
      hook: [
        {
          phase: "pre_emit",
          command: "echo hi",
          on_error: "block",
          mutate: "event",
        },
      ],
    };
    expect(validateHookSpecs(raw)).toHaveLength(0);
  });

  it("flags an unknown phase", () => {
    const raw = { hook: [{ phase: "bogus", command: "echo hi" }] };
    const errors = validateHookSpecs(raw);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("phase");
  });

  it("flags a missing/empty command", () => {
    const raw = { hook: [{ phase: "pre_run" }] };
    const errors = validateHookSpecs(raw);
    expect(errors.some((e) => e.field === "command")).toBe(true);
  });

  it("flags an unknown on_error policy", () => {
    const raw = {
      hook: [{ phase: "pre_run", command: "echo", on_error: "yeet" }],
    };
    const errors = validateHookSpecs(raw);
    expect(errors.some((e) => e.field === "on_error")).toBe(true);
  });

  it("flags an unknown mutate value", () => {
    const raw = {
      hook: [{ phase: "pre_run", command: "echo", mutate: "yeet" }],
    };
    const errors = validateHookSpecs(raw);
    expect(errors.some((e) => e.field === "mutate")).toBe(true);
  });

  it("is a no-op when there is no [[hook]] table", () => {
    expect(validateHookSpecs({ hooks: { pre_run: "echo" } })).toHaveLength(0);
  });
});

describe("hooks-schema: suspend state", () => {
  it("SUSPEND_STATE_SCHEMA_VERSION is 1", () => {
    expect(SUSPEND_STATE_SCHEMA_VERSION).toBe(1);
  });

  it("isSuspendState validates a well-formed record", () => {
    const state = {
      schemaVersion: 1,
      runId: "run-1",
      phase: "pre_iteration" as const,
      iteration: 3,
      reason: "needs approval",
      hookCommand: "echo hi",
      createdAt: new Date().toISOString(),
      resumeIteration: 3,
    };
    expect(isSuspendState(state)).toBe(true);
  });

  it("isSuspendState rejects malformed/partial records", () => {
    expect(isSuspendState(null)).toBe(false);
    expect(isSuspendState({})).toBe(false);
    expect(
      isSuspendState({
        schemaVersion: 1,
        runId: "r",
        phase: "not_a_phase",
        iteration: 1,
        reason: "x",
        hookCommand: "y",
        createdAt: "z",
        resumeIteration: 1,
      }),
    ).toBe(false);
  });
});
