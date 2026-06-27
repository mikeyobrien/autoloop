import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTopic } from "@mobrienv/autoloop-core/journal";
import {
  reinjectPostconditionFailure,
  runPostconditionGuards,
} from "@mobrienv/autoloop-harness/postconditions";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { beforeEach, describe, expect, it } from "vitest";

function git(cwd: string, args: string[]): void {
  const res = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  }
}

let workDir: string;
let journalFile: string;

function initRepo(): void {
  workDir = mkdtempSync(join(tmpdir(), "autoloop-postcond-"));
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  journalFile = join(stateDir, "journal.jsonl");
  writeFileSync(journalFile, "", "utf-8");
  git(workDir, ["init", "-q"]);
  git(workDir, ["config", "user.email", "t@t.t"]);
  git(workDir, ["config", "user.name", "t"]);
  writeFileSync(join(workDir, "main.ts"), "export const x = 1;\n");
  git(workDir, ["add", "."]);
  git(workDir, ["commit", "-qm", "baseline"]);
}

function loopWith(flags: Partial<LoopContext["acceptance"]>): LoopContext {
  return {
    acceptance: {
      verifyCmds: [],
      timeoutMs: 30000,
      assertNoTodo: false,
      assertNoSkippedTests: false,
      assertNoSecrets: false,
      assertCleanTree: false,
      ...flags,
    },
    paths: { workDir, journalFile },
    runtime: { runId: "run-pc" },
  } as unknown as LoopContext;
}

function appendToTracked(text: string): void {
  writeFileSync(join(workDir, "main.ts"), `export const x = 1;\n${text}\n`);
}

beforeEach(initRepo);

describe("runPostconditionGuards", () => {
  it("is a no-op when no guards are enabled", () => {
    appendToTracked("// TODO: something");
    const result = runPostconditionGuards(loopWith({}), 2);
    expect(result).toEqual({ ran: false, passed: true, violations: [] });
  });

  it("no_todo: blocks on a newly added TODO, passes when clean", () => {
    appendToTracked("// TODO: finish this");
    const bad = runPostconditionGuards(loopWith({ assertNoTodo: true }), 2);
    expect(bad.passed).toBe(false);
    expect(bad.violations[0].id).toBe("no_todo");

    initRepo();
    appendToTracked("const done = true;");
    const ok = runPostconditionGuards(loopWith({ assertNoTodo: true }), 2);
    expect(ok.passed).toBe(true);
  });

  it("no_todo: catches a TODO in a newly created untracked file", () => {
    writeFileSync(join(workDir, "new.ts"), "// FIXME: later\n");
    const result = runPostconditionGuards(loopWith({ assertNoTodo: true }), 2);
    expect(result.passed).toBe(false);
    expect(result.violations[0].detail).toContain("new.ts");
  });

  it("no_skipped_tests: blocks on it.only / pytest skip", () => {
    appendToTracked('it.only("x", () => {});');
    const result = runPostconditionGuards(
      loopWith({ assertNoSkippedTests: true }),
      2,
    );
    expect(result.passed).toBe(false);
    expect(result.violations[0].id).toBe("no_skipped_tests");
  });

  it("no_secrets: blocks on an AWS key and a private key header", () => {
    appendToTracked("const k = 'AKIAIOSFODNN7EXAMPLE';");
    const result = runPostconditionGuards(
      loopWith({ assertNoSecrets: true }),
      2,
    );
    expect(result.passed).toBe(false);
    expect(result.violations[0].id).toBe("no_secrets");
  });

  it("no_secrets: allows ordinary code", () => {
    appendToTracked("const url = 'https://example.com/path';");
    const result = runPostconditionGuards(
      loopWith({ assertNoSecrets: true }),
      2,
    );
    expect(result.passed).toBe(true);
  });

  it("clean_tree: blocks on a dirty/untracked tree, passes when committed", () => {
    writeFileSync(join(workDir, "stray.txt"), "junk\n");
    const bad = runPostconditionGuards(loopWith({ assertCleanTree: true }), 2);
    expect(bad.passed).toBe(false);
    expect(bad.violations[0].id).toBe("clean_tree");

    git(workDir, ["add", "."]);
    git(workDir, ["commit", "-qm", "tidy"]);
    const ok = runPostconditionGuards(loopWith({ assertCleanTree: true }), 2);
    expect(ok.passed).toBe(true);
  });

  it("aggregates multiple violations", () => {
    appendToTracked("// TODO: x\nit.only('y', () => {});");
    const result = runPostconditionGuards(
      loopWith({ assertNoTodo: true, assertNoSkippedTests: true }),
      2,
    );
    expect(result.violations.map((v) => v.id).sort()).toEqual([
      "no_skipped_tests",
      "no_todo",
    ]);
  });

  it("skips git-dependent guards outside a git work tree (does not fail)", () => {
    const nonRepo = mkdtempSync(join(tmpdir(), "autoloop-nogit-"));
    mkdirSync(join(nonRepo, ".autoloop"), { recursive: true });
    const jf = join(nonRepo, ".autoloop", "journal.jsonl");
    writeFileSync(jf, "", "utf-8");
    const loop = {
      acceptance: {
        verifyCmds: [],
        timeoutMs: 30000,
        assertNoTodo: true,
        assertNoSkippedTests: false,
        assertNoSecrets: false,
        assertCleanTree: true,
      },
      paths: { workDir: nonRepo, journalFile: jf },
      runtime: { runId: "run-nogit" },
    } as unknown as LoopContext;
    const result = runPostconditionGuards(loop, 2);
    expect(result.ran).toBe(true);
    expect(result.passed).toBe(true);
  });
});

describe("reinjectPostconditionFailure", () => {
  it("appends operator.guidance with the violation detail", () => {
    const loop = loopWith({});
    reinjectPostconditionFailure(loop, 2, {
      ran: true,
      passed: false,
      violations: [{ id: "no_todo", detail: "main.ts: // TODO: x" }],
    });
    const raw = readFileSync(journalFile, "utf-8");
    const topics = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => extractTopic(l));
    expect(topics).toContain("operator.guidance");
    expect(raw).toContain("no_todo");
    expect(raw).toContain("blocked");
  });
});
