/**
 * Run artifacts collection and formatting.
 * Aggregates event counts, memory stats, guidance stats, commits,
 * and document artifacts from journal lines.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import * as config from "../config.js";
import { decodeEvent } from "../events/decode.js";
import type { JournalEvent } from "../events/types.js";
import * as memory from "../memory.js";
import { topicCategory } from "./journal-format.js";

export interface DocumentArtifact {
  path: string;
  kind: string;
  title: string;
  missing: boolean;
}

export interface RunArtifacts {
  runId: string;
  preset: string;
  status: string;
  durationMs: number;
  iterations: number;
  events: {
    total: number;
    loop: number;
    iteration: number;
    backend: number;
    review: number;
    coordination: number;
    operator: number;
    routing: number;
    errors: number;
  };
  artifacts: {
    scratchpadEntries: number;
    memoryLearnings: number;
    memoryMeta: number;
    memoryPreferences: number;
    guidanceSent: number;
    guidanceConsumed: number;
    backpressure: number;
  };
  output: {
    commits: number;
    filesChanged: number;
    journalSizeBytes: number;
  };
  documents: DocumentArtifact[];
}

/**
 * Collect aggregated artifacts from journal lines and filesystem.
 */
export function collectArtifacts(
  lines: string[],
  projectDir: string,
  workDir?: string,
): RunArtifacts {
  const events = {
    total: 0,
    loop: 0,
    iteration: 0,
    backend: 0,
    review: 0,
    coordination: 0,
    operator: 0,
    routing: 0,
    errors: 0,
  };

  let runId = "";
  let preset = "";
  let status = "unknown";
  let startTs = "";
  let endTs = "";
  let maxIter = 0;
  let scratchpadEntries = 0;
  let guidanceSent = 0;
  let guidanceConsumed = 0;
  let backpressure = 0;
  const commits: string[] = [];
  let filesChanged = -1;
  const documents: DocumentArtifact[] = [];
  const documentPaths = new Set<string>();

  for (const line of lines) {
    const event = decodeEvent(line);
    if (!event) continue;

    events.total++;
    const cat = topicCategory(event.topic);
    const key = cat === "error" ? "errors" : cat;
    if (key in events) {
      events[key as keyof typeof events]++;
    }

    // Track iteration count
    if (event.iteration) {
      const n = Number.parseInt(event.iteration, 10);
      if (!Number.isNaN(n) && n > maxIter) maxIter = n;
    }

    // Extract run metadata from loop.start
    if (event.topic === "loop.start") {
      if (event.run) runId = event.run;
      if (event.shape === "fields") {
        preset = event.fields.preset ?? preset;
      }
      startTs = extractTs(event, line);
      status = "active";
    }

    if (event.topic === "loop.complete") {
      status = "completed";
      endTs = extractTs(event, line);
    }

    if (event.topic === "loop.stop") {
      status = "stopped";
      endTs = extractTs(event, line);
    }

    // Scratchpad entries from iteration.finish
    if (event.topic === "iteration.finish") {
      scratchpadEntries++;
    }

    // Guidance tracking
    if (event.topic === "operator.guidance") guidanceSent++;
    if (event.topic === "operator.guidance.consumed") guidanceConsumed++;

    // Backpressure from event.invalid
    if (event.topic === "event.invalid") backpressure++;

    // Commits from slice.committed
    if (event.topic === "slice.committed" && event.shape === "fields") {
      const hash = event.fields.commit ?? event.fields.hash ?? "";
      if (hash) commits.push(hash);
      const fc = event.fields.files_changed ?? event.fields.filesChanged ?? "";
      if (fc) {
        const n = Number.parseInt(fc, 10);
        if (!Number.isNaN(n)) filesChanged = Math.max(filesChanged, 0) + n;
      }
    }

    // Document artifacts from artifact.created events
    if (event.topic === "artifact.created" && event.shape === "fields") {
      const docPath = event.fields.path ?? "";
      if (docPath && !documentPaths.has(docPath)) {
        documentPaths.add(docPath);
        const resolvedDir = workDir ?? projectDir;
        const fullPath = join(resolvedDir, docPath);
        documents.push({
          path: docPath,
          kind: event.fields.kind ?? "other",
          title: event.fields.title ?? docPath,
          missing: !existsSync(fullPath),
        });
      }
    }
  }

  // Fallback: scan for frontmatter if no artifact.created events found
  if (documents.length === 0 && workDir) {
    const scanned = scanFrontmatterArtifacts(workDir);
    for (const doc of scanned) {
      if (!documentPaths.has(doc.path)) {
        documentPaths.add(doc.path);
        documents.push(doc);
      }
    }
  }

  // Memory stats
  let memStats = { learnings: 0, meta: 0, preferences: 0 };
  try {
    const stats = memory.statsProject(projectDir, 8000);
    memStats = {
      learnings: stats.learnings,
      meta: stats.meta,
      preferences: stats.preferences,
    };
  } catch {
    // memory file may not exist
  }

  // Journal file size
  let journalSizeBytes = 0;
  try {
    const journalPath = config.resolveJournalFile(projectDir);
    if (existsSync(journalPath)) {
      journalSizeBytes = statSync(journalPath).size;
    }
  } catch {
    // ignore
  }

  // Duration
  let durationMs = 0;
  if (startTs && endTs) {
    const start = new Date(startTs).getTime();
    const end = new Date(endTs).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end)) {
      durationMs = end - start;
    }
  }

  return {
    runId,
    preset,
    status,
    durationMs,
    iterations: maxIter,
    events,
    artifacts: {
      scratchpadEntries,
      memoryLearnings: memStats.learnings,
      memoryMeta: memStats.meta,
      memoryPreferences: memStats.preferences,
      guidanceSent,
      guidanceConsumed,
      backpressure,
    },
    output: {
      commits: commits.length,
      filesChanged: filesChanged < 0 ? -1 : filesChanged,
      journalSizeBytes,
    },
    documents,
  };
}

/** Format RunArtifacts into a human-readable terminal string. */
export function formatArtifacts(a: RunArtifacts): string {
  const lines: string[] = [];
  const statusNote = a.status === "active" ? " (run still active)" : "";

  const presetLabel = a.preset
    ? ` (${a.preset}${a.status !== "unknown" ? `, ${a.status}` : ""})`
    : "";
  lines.push(`Run: ${a.runId}${presetLabel}${statusNote}`);

  if (a.durationMs > 0) {
    lines.push(
      `Duration: ${formatDuration(a.durationMs)} (${a.iterations} iterations)`,
    );
  } else {
    lines.push(`Iterations: ${a.iterations}`);
  }

  lines.push("");
  lines.push("Events");
  lines.push(`  total           ${a.events.total}`);
  lines.push(`  loop            ${a.events.loop}`);
  lines.push(`  iteration       ${a.events.iteration}`);
  lines.push(`  backend         ${a.events.backend}`);
  lines.push(`  review          ${a.events.review}`);
  lines.push(`  coordination    ${a.events.coordination}`);
  lines.push(`  operator        ${a.events.operator}`);
  lines.push(`  routing/wave    ${a.events.routing}`);
  lines.push(`  errors          ${a.events.errors}`);

  lines.push("");
  lines.push("Artifacts");
  lines.push(`  scratchpad      ${a.artifacts.scratchpadEntries} entries`);
  lines.push(
    `  memory          ${a.artifacts.memoryLearnings} learnings, ${a.artifacts.memoryMeta} meta, ${a.artifacts.memoryPreferences} preferences`,
  );
  lines.push(
    `  guidance        ${a.artifacts.guidanceSent} sent, ${a.artifacts.guidanceConsumed} consumed`,
  );
  lines.push(
    `  backpressure    ${a.artifacts.backpressure} rejected event${a.artifacts.backpressure === 1 ? "" : "s"}`,
  );

  lines.push("");
  lines.push("Output");
  lines.push(`  commits         ${a.output.commits}`);
  lines.push(
    `  files changed   ${a.output.filesChanged < 0 ? "-" : String(a.output.filesChanged)}`,
  );
  lines.push(`  journal size    ${formatBytes(a.output.journalSizeBytes)}`);

  if (a.documents.length > 0) {
    lines.push("");
    lines.push("Documents");
    for (const doc of a.documents) {
      const label = doc.missing ? " (missing)" : "";
      const padPath = doc.path.padEnd(42);
      lines.push(`  ${padPath} ${doc.kind.padEnd(10)} "${doc.title}"${label}`);
    }
  }

  return lines.join("\n");
}

function extractTs(event: JournalEvent, line: string): string {
  if (event.shape === "fields") {
    return event.fields.timestamp ?? event.fields.ts ?? "";
  }
  // Try raw line extraction for payload events
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    return String(parsed.timestamp ?? parsed.ts ?? "");
  } catch {
    return "";
  }
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

/**
 * Scan a directory for .md files with autoloop frontmatter.
 * Checks first 20 lines for `autoloop:` in YAML frontmatter.
 */
function scanFrontmatterArtifacts(dir: string): DocumentArtifact[] {
  const results: DocumentArtifact[] = [];
  try {
    scanDir(dir, dir, results, 0);
  } catch {
    // ignore filesystem errors
  }
  return results;
}

function scanDir(
  baseDir: string,
  currentDir: string,
  results: DocumentArtifact[],
  depth: number,
): void {
  if (depth > 4) return; // limit recursion depth
  try {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name.startsWith(".") &&
        depth === 0 &&
        entry.name !== ".autoloop"
      )
        continue;
      if (entry.name === "node_modules") continue;
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        scanDir(baseDir, fullPath, results, depth + 1);
      } else if (entry.isFile() && extname(entry.name) === ".md") {
        const doc = checkFrontmatter(baseDir, fullPath);
        if (doc) results.push(doc);
      }
    }
  } catch {
    // ignore permission errors etc.
  }
}

function checkFrontmatter(
  baseDir: string,
  filePath: string,
): DocumentArtifact | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const firstLines = content.split("\n").slice(0, 20).join("\n");
    if (!firstLines.includes("autoloop:")) return null;
    // Must be in YAML frontmatter (between --- markers)
    if (!firstLines.startsWith("---")) return null;
    const endIdx = firstLines.indexOf("---", 3);
    if (endIdx < 0) return null;
    const fm = firstLines.slice(3, endIdx);
    if (!fm.includes("autoloop:")) return null;

    // Extract kind from frontmatter
    const kindMatch = fm.match(/kind:\s*(\S+)/);
    const kind = kindMatch?.[1] ?? "other";

    // Extract title from first heading after frontmatter
    const afterFm = content.slice(endIdx + 3).trim();
    const headingMatch = afterFm.match(/^#\s+(.+)/m);
    const title = headingMatch?.[1]?.trim() ?? filePath.split("/").pop() ?? "";

    const relPath = filePath.slice(baseDir.length + 1);
    return { path: relPath, kind, title, missing: false };
  } catch {
    return null;
  }
}
