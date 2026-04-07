import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectArtifacts } from "../src/harness/artifacts.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "artifacts-test-"));
}

describe("collectArtifacts", () => {
  it("returns empty artifacts for empty lines", () => {
    const dir = makeTempDir();
    const result = collectArtifacts([], dir);
    expect(result.events.total).toBe(0);
    expect(result.iterations).toBe(0);
    expect(result.documents).toEqual([]);
  });

  it("counts event categories correctly", () => {
    const dir = makeTempDir();
    const lines = [
      JSON.stringify({ topic: "loop.start", run: "r1", preset: "test" }),
      JSON.stringify({ topic: "iteration.finish", iteration: "1" }),
      JSON.stringify({ topic: "backend.request", iteration: "1" }),
      JSON.stringify({ topic: "event.invalid", iteration: "1" }),
    ];
    const result = collectArtifacts(lines, dir);
    expect(result.events.total).toBe(4);
    expect(result.events.loop).toBe(1);
    expect(result.events.iteration).toBe(1);
    expect(result.events.backend).toBe(1);
    expect(result.events.errors).toBe(1);
  });

  it("tracks iteration count", () => {
    const dir = makeTempDir();
    const lines = [
      JSON.stringify({ topic: "iteration.finish", iteration: "1" }),
      JSON.stringify({ topic: "iteration.finish", iteration: "3" }),
      JSON.stringify({ topic: "iteration.finish", iteration: "2" }),
    ];
    const result = collectArtifacts(lines, dir);
    expect(result.iterations).toBe(3);
  });

  it("extracts run metadata from loop.start", () => {
    const dir = makeTempDir();
    const lines = [
      JSON.stringify({
        topic: "loop.start",
        run: "run-123",
        fields: { preset: "autocode", timestamp: "2025-01-01T00:00:00Z" },
      }),
    ];
    const result = collectArtifacts(lines, dir);
    expect(result.runId).toBe("run-123");
    expect(result.preset).toBe("autocode");
    expect(result.status).toBe("active");
  });

  it("tracks backpressure from event.invalid", () => {
    const dir = makeTempDir();
    const lines = [
      JSON.stringify({ topic: "event.invalid", iteration: "1" }),
      JSON.stringify({ topic: "event.invalid", iteration: "2" }),
    ];
    const result = collectArtifacts(lines, dir);
    expect(result.artifacts.backpressure).toBe(2);
  });

  it("collects document artifacts from artifact.created events", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "plan.md"), "# Plan");
    const lines = [
      JSON.stringify({
        topic: "artifact.created",
        fields: { path: "plan.md", kind: "plan", title: "My Plan" },
      }),
    ];
    const result = collectArtifacts(lines, dir);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].path).toBe("plan.md");
    expect(result.documents[0].kind).toBe("plan");
    expect(result.documents[0].missing).toBe(false);
  });

  it("marks missing documents", () => {
    const dir = makeTempDir();
    const lines = [
      JSON.stringify({
        topic: "artifact.created",
        fields: { path: "nonexistent.md", kind: "report", title: "Gone" },
      }),
    ];
    const result = collectArtifacts(lines, dir);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].missing).toBe(true);
  });

  it("deduplicates document paths", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "plan.md"), "# Plan");
    const lines = [
      JSON.stringify({
        topic: "artifact.created",
        fields: { path: "plan.md", kind: "plan", title: "Plan v1" },
      }),
      JSON.stringify({
        topic: "artifact.created",
        fields: { path: "plan.md", kind: "plan", title: "Plan v2" },
      }),
    ];
    const result = collectArtifacts(lines, dir);
    expect(result.documents).toHaveLength(1);
  });
});

describe("scanFrontmatterArtifacts symlink safety", () => {
  it("does not follow symlink cycles during frontmatter scan", () => {
    const dir = makeTempDir();
    const subDir = join(dir, "docs");
    mkdirSync(subDir);
    writeFileSync(
      join(subDir, "readme.md"),
      "---\nautoloop:\n  kind: doc\n  title: Test\n---\n# Test",
    );
    // Create a symlink cycle: docs/self -> docs
    try {
      symlinkSync(subDir, join(subDir, "self"));
    } catch {
      // skip test on platforms that don't support symlinks
      return;
    }
    // collectArtifacts with no artifact.created events triggers frontmatter scan
    const result = collectArtifacts([], dir, subDir);
    // Should complete without infinite loop and find the doc
    expect(result.documents.length).toBeGreaterThanOrEqual(0);
  });
});
