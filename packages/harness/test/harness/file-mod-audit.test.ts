import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractField, extractTopic } from "@mobrienv/autoloop-core/journal";
import { runFileModAudit } from "@mobrienv/autoloop-harness/file-mod-audit";
import type { IterationContext } from "@mobrienv/autoloop-harness/prompt";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

function git(cwd: string, args: string[]): void {
  const res = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
}

let workDir: string;
let journalFile: string;

function initRepo(): void {
  workDir = mkdtempSync(join(tmpdir(), "autoloop-file-mod-audit-"));
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  journalFile = join(stateDir, "journal.jsonl");
  writeFileSync(journalFile, "", "utf-8");
  git(workDir, ["init", "-q"]);
  git(workDir, ["config", "user.email", "t@t.t"]);
  git(workDir, ["config", "user.name", "t"]);
  writeFileSync(join(workDir, "app.ts"), "export const x = 1;\n");
  git(workDir, ["add", "."]);
  git(workDir, ["commit", "-qm", "baseline"]);
}

beforeEach(initRepo);

function makeIter(allowedRoles: string[]): IterationContext {
  return { allowedRoles } as unknown as IterationContext;
}

function makeLoop(
  auditEnabled: boolean,
  roles: Array<{
    id: string;
    disallowedTools?: string[];
    readOnly?: boolean;
  }>,
  onEvent?: (event: unknown) => void,
): LoopContext {
  return {
    policy: { fileModAudit: auditEnabled },
    topology: { roles },
    paths: { workDir, journalFile },
    runtime: { runId: "run-audit" },
    onEvent,
  } as unknown as LoopContext;
}

describe("runFileModAudit", () => {
  it("is a no-op when the policy is disabled, even with dirty tree + restricted role", () => {
    writeFileSync(join(workDir, "app.ts"), "export const x = 2;\n");
    const loop = makeLoop(false, [{ id: "critic", readOnly: true }]);
    const result = runFileModAudit(loop, makeIter(["critic"]), 2);
    expect(result).toEqual({ ran: false, violated: false, violations: [] });
  });

  it("runs but does not violate when no files changed", () => {
    const loop = makeLoop(true, [{ id: "critic", readOnly: true }]);
    const result = runFileModAudit(loop, makeIter(["critic"]), 2);
    expect(result).toEqual({ ran: true, violated: false, violations: [] });
  });

  it("does not violate when the acting role has no restrictions", () => {
    writeFileSync(join(workDir, "app.ts"), "export const x = 2;\n");
    const loop = makeLoop(true, [{ id: "builder" }]);
    const result = runFileModAudit(loop, makeIter(["builder"]), 2);
    expect(result.violated).toBe(false);
  });

  it("emits a violation when a read_only role modifies files", () => {
    writeFileSync(join(workDir, "app.ts"), "export const x = 2;\n");
    const onEvent = vi.fn();
    const loop = makeLoop(true, [{ id: "critic", readOnly: true }], onEvent);
    const result = runFileModAudit(loop, makeIter(["critic"]), 2);

    expect(result.violated).toBe(true);
    expect(result.violations).toEqual([
      { role: "critic", files: ["app.ts"], reason: "read_only" },
    ]);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "policy.file_modification_violation",
        role: "critic",
        files: ["app.ts"],
        reason: "read_only",
      }),
    );

    const raw = readFileSync(journalFile, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    const journaled = lines.find(
      (l) => extractTopic(l) === "policy.file_modification_violation",
    );
    expect(journaled).toBeDefined();
    expect(extractField(journaled ?? "", "role")).toBe("critic");
  });

  it("emits a violation when a role with disallowed_tools modifies files", () => {
    writeFileSync(join(workDir, "app.ts"), "export const x = 2;\n");
    const loop = makeLoop(true, [
      { id: "critic", disallowedTools: ["Edit", "Write"] },
    ]);
    const result = runFileModAudit(loop, makeIter(["critic"]), 2);

    expect(result.violated).toBe(true);
    expect(result.violations[0]).toEqual({
      role: "critic",
      files: ["app.ts"],
      reason: "disallowed_tools",
    });
  });

  it("catches new untracked files created by a restricted role", () => {
    writeFileSync(join(workDir, "new-file.ts"), "export const y = 1;\n");
    const loop = makeLoop(true, [{ id: "critic", readOnly: true }]);
    const result = runFileModAudit(loop, makeIter(["critic"]), 2);
    expect(result.violated).toBe(true);
    expect(result.violations[0].files).toContain("new-file.ts");
  });

  it("skips the audit when the acting role is ambiguous (multiple allowed roles)", () => {
    writeFileSync(join(workDir, "app.ts"), "export const x = 2;\n");
    const loop = makeLoop(true, [
      { id: "critic", readOnly: true },
      { id: "builder" },
    ]);
    const result = runFileModAudit(loop, makeIter(["critic", "builder"]), 2);
    expect(result).toEqual({ ran: true, violated: false, violations: [] });
  });

  it("skips the audit when the acting role is unknown to the topology", () => {
    writeFileSync(join(workDir, "app.ts"), "export const x = 2;\n");
    const loop = makeLoop(true, [{ id: "builder" }]);
    const result = runFileModAudit(loop, makeIter(["ghost"]), 2);
    expect(result).toEqual({ ran: true, violated: false, violations: [] });
  });

  it("runs but does not violate outside a git work tree", () => {
    const nonRepo = mkdtempSync(join(tmpdir(), "autoloop-file-mod-nogit-"));
    mkdirSync(join(nonRepo, ".autoloop"), { recursive: true });
    const jf = join(nonRepo, ".autoloop", "journal.jsonl");
    writeFileSync(jf, "", "utf-8");
    const loop = {
      policy: { fileModAudit: true },
      topology: { roles: [{ id: "critic", readOnly: true }] },
      paths: { workDir: nonRepo, journalFile: jf },
      runtime: { runId: "r" },
    } as unknown as LoopContext;
    const result = runFileModAudit(loop, makeIter(["critic"]), 2);
    expect(result).toEqual({ ran: true, violated: false, violations: [] });
  });
});
