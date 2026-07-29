import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readRunLines } from "@mobrienv/autoloop-core/journal";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureBuild, ROOT } from "../helpers/runtime.js";

beforeAll(() => {
  ensureBuild();
});

const CONTRACTS_DIR = join(ROOT, "test/fixtures/contracts");

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
    const path = join(CONTRACTS_DIR, "journal-v1-minimal.jsonl");
    const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    const tempDir = mkdtempSync(join(tmpdir(), "compat-test-"));
    const journalPath = join(tempDir, "journal.jsonl");
    const content = readFileSync(path, "utf-8");
    writeFileSync(journalPath, content);

    const lines = readRunLines(journalPath, "test-golden-run-1");
    expect(lines.length).toBeGreaterThan(0);

    rmSync(tempDir, { recursive: true });
  });

  it("journal contract remains stable (no breaking schema changes)", () => {
    const path = join(CONTRACTS_DIR, "journal-v1-minimal.jsonl");
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
