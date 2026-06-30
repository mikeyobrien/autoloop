import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTopic } from "@mobrienv/autoloop-core/journal";
import {
  isTestFile,
  reinjectTamperFailure,
  runTamperScreen,
} from "@mobrienv/autoloop-harness/tamper";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { beforeEach, describe, expect, it } from "vitest";

function git(cwd: string, args: string[]): void {
  const res = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
}

let workDir: string;
let journalFile: string;

function initRepo(): void {
  workDir = mkdtempSync(join(tmpdir(), "autoloop-tamper-"));
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  journalFile = join(stateDir, "journal.jsonl");
  writeFileSync(journalFile, "", "utf-8");
  git(workDir, ["init", "-q"]);
  git(workDir, ["config", "user.email", "t@t.t"]);
  git(workDir, ["config", "user.name", "t"]);
  writeFileSync(join(workDir, "app.ts"), "export const x = 1;\n");
  writeFileSync(
    join(workDir, "app.test.ts"),
    "import { x } from './app';\nit('x', () => { expect(x).toBe(1); });\n",
  );
  git(workDir, ["add", "."]);
  git(workDir, ["commit", "-qm", "baseline"]);
}

function loop(screen: boolean): LoopContext {
  return {
    acceptance: { screenTestTamper: screen },
    paths: { workDir, journalFile },
    runtime: { runId: "run-tamper" },
  } as unknown as LoopContext;
}

beforeEach(initRepo);

describe("isTestFile", () => {
  it("matches common test path shapes", () => {
    for (const p of [
      "app.test.ts",
      "foo.spec.tsx",
      "tests/thing.ts",
      "src/__tests__/a.js",
      "test_foo.py",
      "foo_test.go",
      "pkg/FooTest.java",
      "spec/foo_spec.rb",
    ]) {
      expect(isTestFile(p)).toBe(true);
    }
  });
  it("does not match ordinary source files", () => {
    for (const p of ["app.ts", "src/index.tsx", "lib/util.go", "README.md"]) {
      expect(isTestFile(p)).toBe(false);
    }
  });
});

describe("runTamperScreen", () => {
  it("is a no-op when disabled", () => {
    writeFileSync(join(workDir, "app.test.ts"), "it.only('x', () => {});\n");
    const result = runTamperScreen(loop(false), 2);
    expect(result).toEqual({ ran: false, passed: true, violations: [] });
  });

  it("blocks when a gating test file is modified this run", () => {
    writeFileSync(
      join(workDir, "app.test.ts"),
      "it('x', () => { expect(1).toBe(1); });\n",
    );
    const result = runTamperScreen(loop(true), 2);
    expect(result.passed).toBe(false);
    expect(result.violations.map((v) => v.id)).toContain("test_files_changed");
  });

  it("passes when only non-test source changed", () => {
    writeFileSync(join(workDir, "app.ts"), "export const x = 2;\n");
    const result = runTamperScreen(loop(true), 2);
    expect(result.passed).toBe(true);
  });

  it("flags it.only inserted in a test file", () => {
    writeFileSync(
      join(workDir, "app.test.ts"),
      "it.only('x', () => { expect(x).toBe(1); });\n",
    );
    const ids = runTamperScreen(loop(true), 2).violations.map((v) => v.id);
    expect(ids).toContain("test_skip_or_only");
  });

  it("flags an early process.exit on a test path", () => {
    writeFileSync(
      join(workDir, "app.test.ts"),
      "process.exit(0);\nit('x', () => {});\n",
    );
    const ids = runTamperScreen(loop(true), 2).violations.map((v) => v.id);
    expect(ids).toContain("test_early_exit");
  });

  it("flags a tautological assertion", () => {
    writeFileSync(
      join(workDir, "app.test.ts"),
      "it('x', () => { expect(true).toBe(true); });\n",
    );
    const ids = runTamperScreen(loop(true), 2).violations.map((v) => v.id);
    expect(ids).toContain("tautological_assert");
  });

  it("catches a tampered test in a newly created untracked test file", () => {
    writeFileSync(join(workDir, "extra.spec.ts"), "it.skip('y', () => {});\n");
    const result = runTamperScreen(loop(true), 2);
    expect(result.passed).toBe(false);
  });

  it("passes (skips) outside a git work tree", () => {
    const nonRepo = mkdtempSync(join(tmpdir(), "autoloop-tamper-nogit-"));
    mkdirSync(join(nonRepo, ".autoloop"), { recursive: true });
    const jf = join(nonRepo, ".autoloop", "journal.jsonl");
    writeFileSync(jf, "", "utf-8");
    const l = {
      acceptance: { screenTestTamper: true },
      paths: { workDir: nonRepo, journalFile: jf },
      runtime: { runId: "r" },
    } as unknown as LoopContext;
    expect(runTamperScreen(l, 2).passed).toBe(true);
  });
});

describe("reinjectTamperFailure", () => {
  it("appends operator.guidance with the violation detail", () => {
    reinjectTamperFailure(loop(true), 2, {
      ran: true,
      passed: false,
      violations: [{ id: "test_files_changed", detail: "app.test.ts" }],
    });
    const raw = readFileSync(journalFile, "utf-8");
    const topics = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => extractTopic(l));
    expect(topics).toContain("operator.guidance");
    expect(raw).toContain("test_files_changed");
    expect(raw).toContain("blocked");
  });
});
