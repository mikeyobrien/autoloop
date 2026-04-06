import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  printBackendOutputTail,
  printIterationBanner,
  printIterationFooter,
  printReviewBanner,
} from "../../src/harness/display.js";
import type { IterationContext } from "../../src/harness/prompt.js";
import type { LoopContext } from "../../src/harness/types.js";

function setIsTTY(value: boolean): void {
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value,
  });
}

function makeLoopContext(): LoopContext {
  return {
    objective: "test objective",
    topology: {
      name: "test-topology",
      completion: "task.complete",
      roles: [],
      handoff: {},
      handoffKeys: [],
    },
    limits: { maxIterations: 6 },
    completion: {
      promise: "LOOP_COMPLETE",
      event: "task.complete",
      requiredEvents: [],
    },
    backend: {
      kind: "command",
      command: "claude",
      args: [],
      promptMode: "stdin",
      timeoutMs: 1000,
    },
    review: {
      enabled: false,
      every: 4,
      kind: "command",
      command: "claude",
      args: [],
      promptMode: "stdin",
      prompt: "",
      timeoutMs: 1000,
    },
    parallel: { enabled: false, maxBranches: 1, branchTimeoutMs: 1000 },
    memory: { budgetChars: 1000 },
    harness: { instructions: "" },
    profiles: { active: [], fragments: new Map(), warnings: [] },
    paths: {
      projectDir: ".",
      workDir: ".",
      stateDir: ".autoloop",
      journalFile: ".autoloop/journal.jsonl",
      memoryFile: ".autoloop/memory.jsonl",
      registryFile: ".autoloop/registry.jsonl",
      toolPath: ".autoloop/autoloops",
      piAdapterPath: ".autoloop/pi-adapter",
      baseStateDir: ".autoloop",
      mainProjectDir: ".",
      worktreeBranch: "",
      worktreePath: "",
      worktreeMetaDir: ".autoloop/meta",
    },
    runtime: {
      runId: "run-test",
      selfCommand: "autoloop",
      promptOverride: null,
      backendOverride: {},
      logLevel: "info",
      branchMode: false,
      isolationMode: "shared",
    },
    launch: {
      preset: "autocode",
      trigger: "cli",
      createdAt: "2026-04-06T00:00:00Z",
      parentRunId: "",
    },
    store: {},
  };
}

function makeIterationContext(): IterationContext {
  return {
    iteration: 2,
    recentEvent: "task.start",
    allowedRoles: ["builder"],
    allowedEvents: ["design.ready"],
    backpressure: "",
    lastRejected: "",
    scratchpadText: "",
    memoryText: "",
    prompt: "",
  };
}

describe("display formatting", () => {
  let logged: string[];
  const originalLog = console.log;
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    logged = [];
    console.log = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
    setIsTTY(true);
  });

  afterEach(() => {
    console.log = originalLog;
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: originalIsTTY,
    });
  });

  describe("printBackendOutputTail", () => {
    it("prints all lines when output is shorter than maxLines", () => {
      printBackendOutputTail("line1\nline2\nline3");
      expect(logged[0]).toContain("last 3 of 3 lines");
      expect(logged[1]).toBe("line1\nline2\nline3");
    });

    it("bounds output to maxLines", () => {
      const lines = Array.from({ length: 300 }, (_, i) => `line-${i + 1}`);
      printBackendOutputTail(lines.join("\n"), 200);
      expect(logged[0]).toContain("last 200 of 300 lines");
      expect(logged[1]).toContain("line-101");
      expect(logged[1]).toContain("line-300");
      expect(logged[1]).not.toContain("line-100\n");
    });

    it("skips printing when output is empty or whitespace", () => {
      printBackendOutputTail("");
      expect(logged.length).toBe(0);

      printBackendOutputTail("   \n  \n  ");
      expect(logged.length).toBe(0);
    });

    it("respects custom maxLines parameter", () => {
      const lines = Array.from({ length: 10 }, (_, i) => `line-${i + 1}`);
      printBackendOutputTail(lines.join("\n"), 5);
      expect(logged[0]).toContain("last 5 of 10 lines");
      expect(logged[1]).toContain("line-6");
      expect(logged[1]).not.toContain("line-5\n");
    });

    it("omits decorative footer but keeps header when stdout is not a tty", () => {
      setIsTTY(false);
      printBackendOutputTail("line1\nline2");
      expect(logged).toEqual([
        "── backend stdout (last 2 of 2 lines) ──",
        "line1\nline2",
      ]);
    });
  });

  it("omits decorative iteration rules when stdout is not a tty", () => {
    setIsTTY(false);
    printIterationBanner(makeLoopContext(), makeIterationContext());
    expect(logged).toEqual([
      "iteration 2/6",
      "role: builder │ event: task.start │ next: design.ready",
    ]);
  });

  it("omits decorative review banner when stdout is not a tty", () => {
    setIsTTY(false);
    printReviewBanner(3);
    expect(logged).toEqual(["review before iteration 3"]);
  });

  it("omits decorative iteration footer when stdout is not a tty", () => {
    setIsTTY(false);
    printIterationFooter(makeIterationContext(), 41);
    expect(logged).toEqual([]);
  });
});
