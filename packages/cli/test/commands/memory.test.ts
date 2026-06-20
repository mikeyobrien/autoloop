import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchMemory } from "../../src/commands/memory.js";

let projectDir: string;
let memFile: string;
let lines: string[];
let savedMemoryFileEnv: string | undefined;
let savedStateDirEnv: string | undefined;

function writeMem(entries: string[]) {
  mkdirSync(join(projectDir, ".autoloop"), { recursive: true });
  writeFileSync(memFile, `${entries.join("\n")}\n`, "utf-8");
}

function learning(id: string, text: string, created?: string): string {
  const createdField = created ? `, "created": "${created}"` : "";
  return `{"id": "${id}", "type": "learning", "text": "${text}", "source": "s"${createdField}}`;
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "autoloop-memory-cli-test-"));
  memFile = join(projectDir, ".autoloop", "memory.jsonl");
  savedMemoryFileEnv = process.env.AUTOLOOP_MEMORY_FILE;
  savedStateDirEnv = process.env.AUTOLOOP_STATE_DIR;
  delete process.env.AUTOLOOP_MEMORY_FILE;
  delete process.env.AUTOLOOP_STATE_DIR;
  lines = [];
  vi.spyOn(console, "log").mockImplementation((...args) => {
    lines.push(args.join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedMemoryFileEnv === undefined) {
    delete process.env.AUTOLOOP_MEMORY_FILE;
  } else {
    process.env.AUTOLOOP_MEMORY_FILE = savedMemoryFileEnv;
  }
  if (savedStateDirEnv === undefined) {
    delete process.env.AUTOLOOP_STATE_DIR;
  } else {
    process.env.AUTOLOOP_STATE_DIR = savedStateDirEnv;
  }
  rmSync(projectDir, { recursive: true, force: true });
});

describe("memory compact", () => {
  it("tombstones duplicates and lists removed ids", () => {
    writeMem([
      learning("mem-1", "always run lint"),
      learning("mem-2", "always run lint"),
      learning("mem-3", "other lesson"),
    ]);
    expect(dispatchMemory(["compact", projectDir])).toBe(true);
    const output = lines.join("\n");
    expect(output).toContain("Scanned 3 learnings");
    expect(output).toContain("tombstoned 1 duplicate(s)");
    expect(output).toContain("mem-2");
    const content = readFileSync(memFile, "utf-8");
    expect(content).toContain('"type": "tombstone"');
    expect(content).toContain('"target_id": "mem-2"');
  });

  it("reports when no duplicates are found", () => {
    writeMem([learning("mem-1", "unique lesson")]);
    dispatchMemory(["compact", projectDir]);
    expect(lines.join("\n")).toContain(
      "Scanned 1 learnings; no duplicates found.",
    );
  });

  it("shows usage with --help", () => {
    dispatchMemory(["compact", "--help"]);
    expect(lines.join("\n")).toContain(
      "Usage: autoloop memory compact [project-dir]",
    );
  });
});

describe("memory prune", () => {
  it("tombstones old learnings and lists removed ids", () => {
    writeMem([
      learning("mem-1", "old lesson", "2020-01-01T00:00:00Z"),
      learning("mem-2", "fresh lesson", new Date().toISOString()),
    ]);
    expect(dispatchMemory(["prune", "--max-age", "30", projectDir])).toBe(true);
    const output = lines.join("\n");
    expect(output).toContain("Scanned 2 learnings");
    expect(output).toContain("tombstoned 1 older than 30 days");
    expect(output).toContain("mem-1");
    const content = readFileSync(memFile, "utf-8");
    expect(content).toContain('"target_id": "mem-1"');
    expect(content).not.toContain('"target_id": "mem-2"');
  });

  it("reports when nothing is old enough to prune", () => {
    writeMem([learning("mem-1", "fresh lesson", new Date().toISOString())]);
    dispatchMemory(["prune", "--max-age", "30", projectDir]);
    expect(lines.join("\n")).toContain(
      "Scanned 1 learnings; none older than 30 days.",
    );
  });

  it("errors when --max-age is missing", () => {
    writeMem([learning("mem-1", "lesson", "2020-01-01T00:00:00Z")]);
    dispatchMemory(["prune", projectDir]);
    const output = lines.join("\n");
    expect(output).toContain("error: prune requires --max-age <days>");
    expect(output).toContain("Usage: autoloop memory prune");
    const content = readFileSync(memFile, "utf-8");
    expect(content).not.toContain("tombstone");
  });

  it("errors on a non-numeric --max-age", () => {
    dispatchMemory(["prune", "--max-age", "soon", projectDir]);
    expect(lines.join("\n")).toContain(
      "error: --max-age must be a positive integer",
    );
  });

  it("errors on zero or negative --max-age", () => {
    dispatchMemory(["prune", "--max-age", "0", projectDir]);
    dispatchMemory(["prune", "--max-age", "-5", projectDir]);
    const errors = lines.filter((l) =>
      l.includes("--max-age must be a positive integer"),
    );
    expect(errors).toHaveLength(2);
  });

  it("errors when --max-age has no value", () => {
    dispatchMemory(["prune", "--max-age"]);
    expect(lines.join("\n")).toContain(
      "error: --max-age must be a positive integer",
    );
  });

  it("shows usage with --help", () => {
    dispatchMemory(["prune", "--help"]);
    expect(lines.join("\n")).toContain(
      "Usage: autoloop memory prune --max-age <days> [project-dir]",
    );
  });
});
