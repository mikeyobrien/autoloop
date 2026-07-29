import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRunLines } from "@mobrienv/autoloop-core/journal";
import {
  activeRuns,
  findRunByPrefix,
  readRegistry,
} from "@mobrienv/autoloop-core/registry";
import type {
  RegistryStatus,
  RunRecord,
} from "@mobrienv/autoloop-core/registry/types";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureBuild, ROOT } from "../helpers/runtime.js";

beforeAll(() => {
  ensureBuild();
});

const CONTRACTS_DIR = join(ROOT, "test/fixtures/contracts");
const REGISTRY_FIXTURE = join(CONTRACTS_DIR, "registry-v1-minimal.jsonl");
const JOURNAL_FIXTURE = join(CONTRACTS_DIR, "journal-v1-minimal.jsonl");

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function registryRecords(): RunRecord[] {
  return readFileSync(REGISTRY_FIXTURE, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as RunRecord);
}

/** Copy the committed fixture into a scratch dir so readers can mutate it. */
function scratchRegistry(): string {
  const path = join(tempDir("compat-registry-"), "registry.jsonl");
  copyFileSync(REGISTRY_FIXTURE, path);
  return path;
}

describe("integration: compatibility contracts (Slice A)", () => {
  it("journal-v1-minimal.jsonl validates with correct schema", () => {
    const path = join(CONTRACTS_DIR, "journal-v1-minimal.jsonl");
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      const obj = JSON.parse(line);

      expect(obj).toHaveProperty("v");
      expect(obj.v).toBe(1);
      expect(obj).toHaveProperty("ts");
      expect(typeof obj.ts).toBe("string");
      expect(obj.ts).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/,
      );
      expect(obj).toHaveProperty("run");
      expect(typeof obj.run).toBe("string");
      expect(obj).toHaveProperty("topic");
      expect(typeof obj.topic).toBe("string");

      if (obj.fields !== undefined) {
        expect(typeof obj.fields).toBe("object");
      } else {
        expect(obj).toHaveProperty("payload");
      }
    }
  });

  it("journal-v1-minimal.jsonl contains expected routing events", () => {
    const path = join(CONTRACTS_DIR, "journal-v1-minimal.jsonl");
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    const topics = lines.map((l) => JSON.parse(l).topic);

    expect(topics).toContain("recon.done");
    expect(topics).toContain("plan.ready");
    expect(topics).toContain("red.ready");
    expect(topics).toContain("task.complete");
  });

  it("journal-v1-minimal.jsonl preserves source field (agent vs harness)", () => {
    const path = join(CONTRACTS_DIR, "journal-v1-minimal.jsonl");
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    const records = lines.map((l) => JSON.parse(l));

    const agentEvents = records.filter((r) => r.source === "agent");
    const harnessEvents = records.filter((r) => r.source === "harness");

    expect(agentEvents.length).toBeGreaterThan(0);
    expect(harnessEvents.length).toBeGreaterThan(0);
  });

  it("can read contracts with readRunLines (core API)", () => {
    const journalPath = join(tempDir("compat-journal-"), "journal.jsonl");
    writeFileSync(journalPath, readFileSync(JOURNAL_FIXTURE, "utf-8"));

    const lines = readRunLines(journalPath, "test-golden-run-1");
    expect(lines.length).toBeGreaterThan(0);
  });

  it("journal contract remains stable (no breaking schema changes)", () => {
    const path = JOURNAL_FIXTURE;
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    expect(() => {
      for (const line of lines) {
        const obj = JSON.parse(line);
        if (!obj.run || !obj.topic) {
          throw new Error("Invalid contract");
        }
      }
    }).not.toThrow();
  });
});

describe("integration: registry compatibility contract (Tier A)", () => {
  const REQUIRED_KEYS: Array<[keyof RunRecord, string]> = [
    ["run_id", "string"],
    ["status", "string"],
    ["preset", "string"],
    ["objective", "string"],
    ["trigger", "string"],
    ["project_dir", "string"],
    ["work_dir", "string"],
    ["state_dir", "string"],
    ["journal_file", "string"],
    ["parent_run_id", "string"],
    ["backend", "string"],
    ["created_at", "string"],
    ["updated_at", "string"],
    ["iteration", "number"],
    ["max_iterations", "number"],
    ["stop_reason", "string"],
    ["latest_event", "string"],
    ["isolation_mode", "string"],
  ];

  const STATUSES: RegistryStatus[] = [
    "running",
    "completed",
    "failed",
    "timed_out",
    "stopped",
  ];

  it("every fixture line parses as a RunRecord with required keys and types", () => {
    const records = registryRecords();
    expect(records.length).toBeGreaterThan(0);

    for (const record of records) {
      for (const [key, type] of REQUIRED_KEYS) {
        expect(record, `missing key ${String(key)}`).toHaveProperty(
          String(key),
        );
        expect(typeof record[key], `wrong type for ${String(key)}`).toBe(type);
      }
      expect(Array.isArray(record.backend_args)).toBe(true);
    }
  });

  it("status is always one of the five documented RegistryStatus values", () => {
    for (const record of registryRecords()) {
      expect(STATUSES).toContain(record.status);
    }
  });

  it("fixture is deterministic: no PIDs, no wall-clock, no host paths", () => {
    const raw = readFileSync(REGISTRY_FIXTURE, "utf-8");
    expect(raw).not.toMatch(/"pid"/);
    expect(raw).not.toContain(ROOT);
    expect(raw).not.toMatch(/\/(Users|home)\//);
    for (const record of registryRecords()) {
      expect(record.created_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
      expect(record.updated_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    }
  });

  it("fixture covers running plus at least one terminal status", () => {
    const statuses = new Set(registryRecords().map((r) => r.status));
    expect(statuses.has("running")).toBe(true);
    expect([...statuses].some((s) => s !== "running")).toBe(true);
  });

  it("readRegistry dedupes duplicate run_id to the last written entry", () => {
    const lines = registryRecords();
    const counts = new Map<string, number>();
    for (const r of lines)
      counts.set(r.run_id, (counts.get(r.run_id) ?? 0) + 1);
    const duplicated = [...counts.entries()].find(([, n]) => n > 1);
    expect(
      duplicated,
      "fixture must contain a duplicate run_id to pin last-write-wins",
    ).toBeDefined();

    const runId = duplicated?.[0] as string;
    const lastWritten = [...lines].reverse().find((r) => r.run_id === runId);
    const records = readRegistry(REGISTRY_FIXTURE);

    expect(records.filter((r) => r.run_id === runId)).toHaveLength(1);
    expect(records.find((r) => r.run_id === runId)).toEqual(lastWritten);
  });

  it("activeRuns returns only records whose status is running", () => {
    const active = activeRuns(REGISTRY_FIXTURE);
    expect(active.length).toBeGreaterThan(0);
    for (const record of active) expect(record.status).toBe("running");

    const expected = readRegistry(REGISTRY_FIXTURE).filter(
      (r) => r.status === "running",
    );
    expect(active).toEqual(expected);
  });

  it("findRunByPrefix resolves a unique prefix to a single record", () => {
    const records = readRegistry(REGISTRY_FIXTURE);
    const target = records[0];
    const prefix = target.run_id.slice(0, 8);
    const unique = records.filter((r) => r.run_id.startsWith(prefix));
    expect(unique).toHaveLength(1);

    expect(findRunByPrefix(REGISTRY_FIXTURE, prefix)).toEqual(target);
    expect(findRunByPrefix(REGISTRY_FIXTURE, target.run_id)).toEqual(target);
    expect(findRunByPrefix(REGISTRY_FIXTURE, "no-such-run")).toBeUndefined();
  });

  it("malformed trailing line is skipped without dropping valid records", () => {
    const path = scratchRegistry();
    const before = readRegistry(path);

    appendFileSync(path, "{ this is not json\n", "utf-8");
    appendFileSync(path, '{"status":"running"}\n', "utf-8"); // no run_id

    let after: RunRecord[] = [];
    expect(() => {
      after = readRegistry(path);
    }).not.toThrow();
    expect(after).toEqual(before);
  });

  it("unknown additive fields are preserved, not fatal (Tier A additive rule)", () => {
    const path = scratchRegistry();
    const base = readRegistry(path)[0];
    appendFileSync(
      path,
      `${JSON.stringify({ ...base, future_field_v2: { nested: true } })}\n`,
      "utf-8",
    );

    const records = readRegistry(path);
    const updated = records.find((r) => r.run_id === base.run_id) as RunRecord &
      Record<string, unknown>;
    expect(updated.future_field_v2).toEqual({ nested: true });
    expect(updated.status).toBe(base.status);
  });
});

describe("integration: contract fixture regeneration is deterministic", () => {
  it("npm run fixtures:contracts reproduces the committed bytes exactly", () => {
    const out = tempDir("compat-regen-");

    execFileSync("npm", ["run", "--silent", "fixtures:contracts"], {
      cwd: ROOT,
      timeout: 120_000,
      env: { ...process.env, AUTOLOOP_FIXTURE_OUT_DIR: out },
    });

    for (const name of [
      "registry-v1-minimal.jsonl",
      "journal-v1-minimal.jsonl",
    ]) {
      const generated = readFileSync(join(out, name));
      const committed = readFileSync(join(CONTRACTS_DIR, name));
      expect(
        generated.equals(committed),
        `${name} drifted; run \`npm run fixtures:contracts\` and review the diff`,
      ).toBe(true);
    }
  });

  it("generator output is stable across two consecutive runs", () => {
    const a = tempDir("compat-regen-a-");
    const b = tempDir("compat-regen-b-");
    for (const out of [a, b]) {
      execFileSync("npm", ["run", "--silent", "fixtures:contracts"], {
        cwd: ROOT,
        timeout: 120_000,
        env: { ...process.env, AUTOLOOP_FIXTURE_OUT_DIR: out },
      });
    }
    const name = "registry-v1-minimal.jsonl";
    expect(
      readFileSync(join(a, name)).equals(readFileSync(join(b, name))),
    ).toBe(true);
  });
});
