import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractField, extractTopic } from "@mobrienv/autoloop-core/journal";
import {
  beginFileModAudit,
  frozenPathMatcher,
  globToRegExp,
  runFileModAudit,
} from "@mobrienv/autoloop-harness/file-mod-audit";
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
    expect(result).toEqual({
      ran: false,
      violated: false,
      violations: [],
      frozenViolated: false,
      frozenViolations: [],
      frozenReverts: [],
    });
  });

  it("runs but does not violate when no files changed", () => {
    const loop = makeLoop(true, [{ id: "critic", readOnly: true }]);
    const result = runFileModAudit(loop, makeIter(["critic"]), 2);
    expect(result).toEqual({
      ran: true,
      violated: false,
      violations: [],
      frozenViolated: false,
      frozenViolations: [],
      frozenReverts: [],
    });
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
    expect(result).toEqual({
      ran: true,
      violated: false,
      violations: [],
      frozenViolated: false,
      frozenViolations: [],
      frozenReverts: [],
    });
  });

  it("skips the audit when the acting role is unknown to the topology", () => {
    writeFileSync(join(workDir, "app.ts"), "export const x = 2;\n");
    const loop = makeLoop(true, [{ id: "builder" }]);
    const result = runFileModAudit(loop, makeIter(["ghost"]), 2);
    expect(result).toEqual({
      ran: true,
      violated: false,
      violations: [],
      frozenViolated: false,
      frozenViolations: [],
      frozenReverts: [],
    });
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
    expect(result).toEqual({
      ran: true,
      violated: false,
      violations: [],
      frozenViolated: false,
      frozenViolations: [],
      frozenReverts: [],
    });
  });
});

describe("T-009 frozen-paths guard", () => {
  function frozenLoop(
    roles: Array<{ id: string; frozenPaths?: string[]; readOnly?: boolean }>,
    policy?: Partial<{ frozenPaths: string[]; frozenPathsBlock: boolean }>,
  ): LoopContext {
    return {
      policy: {
        fileModAudit: false,
        frozenPaths: policy?.frozenPaths ?? [],
        frozenPathsBlock: policy?.frozenPathsBlock ?? false,
      },
      topology: { roles },
      paths: { workDir, journalFile },
      runtime: { runId: "run-frozen" },
    } as unknown as LoopContext;
  }

  function gitShaOf(path: string): string {
    const res = spawnSync("git", ["hash-object", path], {
      cwd: workDir,
      encoding: "utf-8",
    });
    return res.stdout.trim();
  }

  it("globToRegExp matches within/across segments and escapes metacharacters", () => {
    expect(globToRegExp("vision.md").test("vision.md")).toBe(true);
    expect(globToRegExp("vision.md").test("docs/vision.md")).toBe(false);
    expect(globToRegExp("**/vision.md").test("docs/vision.md")).toBe(true);
    expect(globToRegExp("**/vision.md").test("vision.md")).toBe(true);
    expect(globToRegExp("docs/**").test("docs/a/b.md")).toBe(true);
    expect(globToRegExp("docs/**").test("other/a.md")).toBe(false);
    expect(globToRegExp("a+b(c).md").test("a+b(c).md")).toBe(true);
    expect(globToRegExp("a+b(c).md").test("ab(c).md")).toBe(false);
    expect(globToRegExp("docs/*.md").test("docs/a.md")).toBe(true);
    expect(globToRegExp("docs/*.md").test("docs/sub/a.md")).toBe(false);
  });

  it("frozenPathMatcher with no patterns never matches", () => {
    expect(frozenPathMatcher([])("vision.md")).toBe(false);
  });

  it("reverts an in-iteration write to a global frozen path and journals the violation", () => {
    const vision = join(workDir, "vision.md");
    writeFileSync(vision, "# Vision v1\n");
    git(workDir, ["add", "."]);
    git(workDir, ["commit", "-qm", "vision"]);
    const shaBefore = gitShaOf(vision);

    const loop = frozenLoop([{ id: "builder" }], {
      frozenPaths: ["vision.md"],
      frozenPathsBlock: true,
    });
    const onEvent = vi.fn();
    loop.onEvent = onEvent;
    const snapshot = beginFileModAudit(loop, makeIter(["builder"]));
    expect(snapshot).not.toBeNull();

    // The "backend" modifies the frozen file mid-iteration.
    writeFileSync(vision, "# hijacked\n");
    const result = runFileModAudit(loop, makeIter(["builder"]), 2, snapshot);

    expect(result.frozenViolated).toBe(true);
    expect(result.frozenViolations).toEqual([
      { role: "builder", files: ["vision.md"] },
    ]);
    expect(result.frozenReverts).toEqual(["vision.md"]);
    // File restored byte-exact.
    expect(gitShaOf(vision)).toBe(shaBefore);
    // Journaled + emitted.
    const raw = readFileSync(journalFile, "utf-8");
    const journaled = raw
      .split("\n")
      .filter((l) => extractTopic(l) === "policy.frozen_path_violation");
    expect(journaled.length).toBe(1);
    expect(extractField(journaled[0] ?? "", "role")).toBe("builder");
    expect(extractField(journaled[0] ?? "", "files")).toBe("vision.md");
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "policy.frozen_path_violation",
        role: "builder",
        files: ["vision.md"],
      }),
    );
  });

  it("removes a file created under a frozen glob and restores deletions", () => {
    const loop = frozenLoop([{ id: "builder" }], {
      frozenPaths: ["docs/**"],
    });
    const snapshot = beginFileModAudit(loop, makeIter(["builder"]));
    // Backend creates docs/owner.md under the frozen glob...
    mkdirSync(join(workDir, "docs"), { recursive: true });
    writeFileSync(join(workDir, "docs", "owner.md"), "new\n");
    const created = runFileModAudit(loop, makeIter(["builder"]), 2, snapshot);
    expect(created.frozenViolated).toBe(true);
    expect(existsSync(join(workDir, "docs", "owner.md"))).toBe(false);

    // ...and deletes a pre-existing frozen file (snapshot "absent" restore).
    writeFileSync(join(workDir, "docs", "keeper.md"), "keep\n");
    const snapshot2 = beginFileModAudit(loop, makeIter(["builder"]));
    unlinkSync(join(workDir, "docs", "keeper.md"));
    const deleted = runFileModAudit(loop, makeIter(["builder"]), 2, snapshot2);
    expect(deleted.frozenViolated).toBe(true);
    expect(readFileSync(join(workDir, "docs", "keeper.md"), "utf-8")).toBe(
      "keep\n",
    );
  });

  it("leaves pre-existing uncommitted frozen-file edits alone (owner writes unaffected)", () => {
    const vision = join(workDir, "vision.md");
    writeFileSync(vision, "# owner local edit\n");
    git(workDir, ["add", "."]);
    git(workDir, ["commit", "-qm", "base"]);
    // Owner edits between iterations (uncommitted).
    writeFileSync(vision, "# owner uncommitted edit\n");

    const loop = frozenLoop([{ id: "builder" }], {
      frozenPaths: ["vision.md"],
    });
    const snapshot = beginFileModAudit(loop, makeIter(["builder"]));
    // Builder does NOT touch the file this iteration.
    const result = runFileModAudit(loop, makeIter(["builder"]), 2, snapshot);
    expect(result.frozenViolated).toBe(false);
    expect(readFileSync(vision, "utf-8")).toBe("# owner uncommitted edit\n");
  });

  it("a role without frozen paths and an empty global list skips the guard", () => {
    writeFileSync(join(workDir, "vision.md"), "x\n");
    const loop = frozenLoop([{ id: "builder" }]);
    expect(beginFileModAudit(loop, makeIter(["builder"]))).toBeNull();
    const result = runFileModAudit(loop, makeIter(["builder"]), 2, null);
    expect(result.frozenViolated).toBe(false);
    expect(result.ran).toBe(false);
  });

  it("respects per-role frozen_paths: restricted role flagged, unrestricted role free", () => {
    const vision = join(workDir, "vision.md");
    writeFileSync(vision, "# Vision\n");
    git(workDir, ["add", "."]);
    git(workDir, ["commit", "-qm", "vision"]);

    const loop = frozenLoop([
      { id: "critic", frozenPaths: ["vision.md"] },
      { id: "owner", frozenPaths: [] },
    ]);
    const snapshot = beginFileModAudit(loop, makeIter(["critic"]));
    expect(snapshot).not.toBeNull();
    writeFileSync(vision, "# critic rewrote\n");
    const flagged = runFileModAudit(loop, makeIter(["critic"]), 2, snapshot);
    expect(flagged.frozenViolated).toBe(true);
    expect(readFileSync(vision, "utf-8")).toBe("# Vision\n");

    // Owner-style role (no frozen paths) writing the same file: not touched.
    writeFileSync(vision, "# owner authoritative edit\n");
    const snapshot2 = beginFileModAudit(loop, makeIter(["owner"]));
    expect(snapshot2).toBeNull();
    const free = runFileModAudit(loop, makeIter(["owner"]), 3, snapshot2);
    expect(free.frozenViolated).toBe(false);
    expect(readFileSync(vision, "utf-8")).toBe("# owner authoritative edit\n");
  });

  it("snapshot is per-iteration: a prior iteration's committed change is not reverted", () => {
    const vision = join(workDir, "vision.md");
    writeFileSync(vision, "# v1\n");
    git(workDir, ["add", "."]);
    git(workDir, ["commit", "-qm", "v1"]);

    const loop = frozenLoop([{ id: "builder" }], {
      frozenPaths: ["vision.md"],
    });
    // Iteration 2: builder writes and the audit restores.
    const snap1 = beginFileModAudit(loop, makeIter(["builder"]));
    writeFileSync(vision, "# v2 by builder\n");
    runFileModAudit(loop, makeIter(["builder"]), 2, snap1);
    expect(readFileSync(vision, "utf-8")).toBe("# v1\n");

    // Iteration 3: fresh snapshot sees restored bytes; no violation without
    // new modification.
    const snap2 = beginFileModAudit(loop, makeIter(["builder"]));
    const clean = runFileModAudit(loop, makeIter(["builder"]), 3, snap2);
    expect(clean.frozenViolated).toBe(false);
  });

  it("skips the guard when the acting role is ambiguous or unknown", () => {
    writeFileSync(join(workDir, "vision.md"), "x\n");
    const loop = frozenLoop([{ id: "builder" }], {
      frozenPaths: ["vision.md"],
    });
    expect(beginFileModAudit(loop, makeIter(["a", "b"]))).toBeNull();
    expect(beginFileModAudit(loop, makeIter(["ghost"]))).toBeNull();
    const ambiguous = runFileModAudit(loop, makeIter(["a", "b"]), 2, null);
    expect(ambiguous.ran).toBe(false);
  });

  it("works without git via the filesystem walk fallback", () => {
    const nonRepo = mkdtempSync(join(tmpdir(), "autoloop-frozen-nogit-"));
    const vision = join(nonRepo, "vision.md");
    writeFileSync(vision, "# no git\n");
    const loop = frozenLoop([{ id: "builder" }], {
      frozenPaths: ["vision.md"],
    });
    loop.paths.workDir = nonRepo;
    const snapshot = beginFileModAudit(loop, makeIter(["builder"]));
    expect(snapshot?.entries.map((e) => e.path)).toEqual(["vision.md"]);
    writeFileSync(vision, "# changed\n");
    const result = runFileModAudit(loop, makeIter(["builder"]), 2, snapshot);
    expect(result.frozenViolated).toBe(true);
    expect(readFileSync(vision, "utf-8")).toBe("# no git\n");
  });
});
