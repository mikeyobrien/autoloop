import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { jsonField } from "@mobrienv/autoloop-core";
import { appendEvent } from "@mobrienv/autoloop-core/journal";
import { changedFiles, isGitRepo, listWorkTreeFiles } from "./git-diff.js";
import type { IterationContext } from "./prompt.js";
import type { LoopContext } from "./types.js";

export type FileModViolationReason = "disallowed_tools" | "read_only";

export interface FileModViolation {
  role: string;
  files: string[];
  reason: FileModViolationReason;
}

export interface FrozenPathViolation {
  role: string;
  files: string[];
}

export interface FileModAuditResult {
  ran: boolean;
  violated: boolean;
  violations: FileModViolation[];
  /** T-009 frozen-paths guard: true when a frozen path was modified. */
  frozenViolated: boolean;
  frozenViolations: FrozenPathViolation[];
  /** Frozen paths the guard restored to their pre-iteration state. */
  frozenReverts: string[];
}

/** Pre-iteration state of one frozen path (bytes, or its absence). */
export interface FrozenPathSnapshotEntry {
  path: string;
  existed: boolean;
  /** Raw bytes when `existed`; Buffers keep restore byte-exact for any file type. */
  contents?: Buffer;
}

export interface FrozenPathSnapshot {
  entries: FrozenPathSnapshotEntry[];
}

/**
 * Compile one workdir-relative glob into an anchored RegExp. A single star
 * matches within one path segment; a double star matches across segments (a
 * leading double star also matches a root-level file, a trailing one matches
 * everything below). Every other character is escaped literally.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = "";
  let i = 0;
  while (i < pattern.length) {
    if (pattern.startsWith("**/", i)) {
      const prevSlash = i === 0 || pattern[i - 1] === "/";
      source += prevSlash ? "(?:.*/)?" : ".*/";
      i += 3;
      continue;
    }
    if (pattern.startsWith("**", i)) {
      source += ".*";
      i += 2;
      continue;
    }
    const ch = pattern[i] as string;
    if (ch === "*") {
      source += "[^/]*";
    } else if (/[a-zA-Z0-9_\-./]/.test(ch)) {
      source += ch;
    } else {
      source += `\\${ch}`;
    }
    i += 1;
  }
  return new RegExp(`^${source}$`);
}

/** Combined matcher for a frozen-paths pattern list (no patterns never matches). */
export function frozenPathMatcher(
  patterns: string[],
): (file: string) => boolean {
  const regexes = patterns
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map(globToRegExp);
  if (regexes.length === 0) return () => false;
  return (file: string) => regexes.some((re) => re.test(file));
}

function resolveActingRole(
  loop: LoopContext,
  iter: IterationContext,
): {
  id: string;
  frozenPaths?: string[];
  readOnly?: boolean;
  disallowedTools?: string[];
} | null {
  // Autoloop runs a single backend per iteration; allowedRoles[0] is the
  // acting role for this turn (same convention prompt.ts uses to resolve
  // per-role backend overrides). Ambiguous/empty routing is skipped rather
  // than guessed, to avoid false-positive violations.
  if (iter.allowedRoles.length !== 1) return null;
  const roleId = iter.allowedRoles[0];
  return loop.topology.roles.find((r) => r.id === roleId) ?? null;
}

/** Global policy patterns plus the acting role's own frozen_paths. */
export function frozenPatternsFor(
  loop: LoopContext,
  role: { frozenPaths?: string[] } | null,
): string[] {
  return [...(loop.policy?.frozenPaths ?? []), ...(role?.frozenPaths ?? [])];
}

/**
 * Snapshot every work-tree file matching `patterns` (tracked + untracked,
 * non-ignored). Captured before the backend runs so the guard can restore
 * byte-exact contents after the iteration, whatever the backend did.
 */
export function captureFrozenSnapshot(
  workDir: string,
  patterns: string[],
): FrozenPathSnapshot {
  const matcher = frozenPathMatcher(patterns);
  const entries: FrozenPathSnapshotEntry[] = [];
  for (const path of listWorkTreeFiles(workDir)) {
    if (!matcher(path)) continue;
    const absolute = join(workDir, path);
    if (existsSync(absolute)) {
      entries.push({ path, existed: true, contents: readFileSync(absolute) });
    } else {
      // Listed (e.g. tracked in the index) but absent from the work tree:
      // the frozen state is "absent".
      entries.push({ path, existed: false });
    }
  }
  return { entries };
}

/**
 * T-009 frozen-paths guard, open phase. Global `event_loop.frozen_paths` plus
 * the acting role's `frozen_paths` declare workdir-relative glob paths a loop
 * role must not modify. When any patterns apply, snapshot the matching files
 * before the backend runs; `runFileModAudit` restores them after. Returns
 * null when the guard is inactive (no patterns, or ambiguous/unknown acting
 * role — mirroring the ralph-parity audit's no-guessing rule).
 */
export function beginFileModAudit(
  loop: LoopContext,
  iter: IterationContext,
): FrozenPathSnapshot | null {
  const role = resolveActingRole(loop, iter);
  if (!role) return null;
  const patterns = frozenPatternsFor(loop, role);
  if (patterns.length === 0) return null;
  return captureFrozenSnapshot(loop.paths.workDir, patterns);
}

function equalBuffers(a: Buffer | null, b: Buffer | null): boolean {
  if (a === null || b === null) return a === b;
  return a.equals(b);
}

/** Paths whose current bytes differ from the snapshot (or that appeared). */
function detectFrozenModifications(
  workDir: string,
  snapshot: FrozenPathSnapshot,
  patterns: string[],
): string[] {
  const matcher = frozenPathMatcher(patterns);
  const snap = new Map(snapshot.entries.map((e) => [e.path, e]));
  const candidates = new Set<string>();
  for (const path of listWorkTreeFiles(workDir)) {
    if (matcher(path)) candidates.add(path);
  }
  for (const entry of snapshot.entries) candidates.add(entry.path);

  const modified: string[] = [];
  for (const path of candidates) {
    const absolute = join(workDir, path);
    const exists = existsSync(absolute);
    const entry = snap.get(path);
    if (!entry) {
      // Created this iteration (no snapshot entry) — the path set is frozen
      // along with the bytes.
      if (exists) modified.push(path);
      continue;
    }
    const current = exists ? readFileSync(absolute) : null;
    const original =
      entry.existed && entry.contents !== undefined ? entry.contents : null;
    if (!equalBuffers(current, original)) modified.push(path);
  }
  return modified;
}

function restoreSnapshot(
  workDir: string,
  snapshot: FrozenPathSnapshot,
  modified: Set<string>,
): string[] {
  const reverted: string[] = [];
  for (const entry of snapshot.entries) {
    if (!modified.has(entry.path)) continue;
    const absolute = join(workDir, entry.path);
    if (entry.existed && entry.contents !== undefined) {
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, entry.contents);
      reverted.push(entry.path);
    } else if (!entry.existed && existsSync(absolute)) {
      unlinkSync(absolute);
      reverted.push(entry.path);
    }
  }
  // Created-then-frozen paths have no snapshot entry: remove them.
  for (const path of modified) {
    if (snapshot.entries.some((e) => e.path === path)) continue;
    const absolute = join(workDir, path);
    if (existsSync(absolute)) {
      unlinkSync(absolute);
      reverted.push(path);
    }
  }
  return reverted;
}

/**
 * Emit-boundary file-mod audit. Two independent, opt-in guards share this
 * seam:
 *
 * 1. Ralph-parity audit (`event_loop.audit_file_mods`, purely
 *    observational): diffs the working tree against HEAD after the
 *    iteration; if the acting role declares `disallowedTools`/`readOnly`
 *    and files changed, journals + emits a typed
 *    `policy.file_modification_violation` event. Never alters control flow.
 *
 * 2. T-009 frozen-paths guard (active whenever frozen patterns exist via
 *    `event_loop.frozen_paths` or the role's `frozen_paths`): detects
 *    modification of frozen paths by content-diff against the snapshot from
 *    {@link beginFileModAudit} — self-consistent even when HEAD already
 *    differs (uncommitted operator edits are protected, not flagged) —
 *    restores the pre-iteration bytes, and journals + emits
 *    `policy.frozen_path_violation`. Under
 *    `event_loop.frozen_paths_block` the caller additionally denies the
 *    acting role's completion claim. Writes made outside any loop role
 *    (owner/operator edits between iterations) are untouched: the snapshot
 *    is per-iteration and only in-iteration drift is reverted.
 *
 * Returns `ran: false` when neither guard is active.
 */
export function runFileModAudit(
  loop: LoopContext,
  iter: IterationContext,
  iteration: number,
  snapshot?: FrozenPathSnapshot | null,
): FileModAuditResult {
  const role = resolveActingRole(loop, iter);
  const auditEnabled = loop.policy?.fileModAudit === true;
  const frozenPatterns = role ? frozenPatternsFor(loop, role) : [];
  const frozenActive = frozenPatterns.length > 0;
  const clean: FileModAuditResult = {
    ran: true,
    violated: false,
    violations: [],
    frozenViolated: false,
    frozenViolations: [],
    frozenReverts: [],
  };
  if (!auditEnabled && !frozenActive) {
    return { ...clean, ran: false };
  }

  // Frozen-paths guard: revert first so the journaled state reflects the
  // post-restore tree.
  if (frozenActive && snapshot) {
    const frozenFiles = detectFrozenModifications(
      loop.paths.workDir,
      snapshot,
      frozenPatterns,
    );
    if (frozenFiles.length > 0) {
      const reverted = restoreSnapshot(
        loop.paths.workDir,
        snapshot,
        new Set(frozenFiles),
      );
      appendEvent(
        loop.paths.journalFile,
        loop.runtime.runId,
        String(iteration),
        "policy.frozen_path_violation",
        `${jsonField("role", role?.id ?? "")}, ${jsonField("files", frozenFiles.join(","))}, ${jsonField("reverted", reverted.join(","))}`,
      );
      loop.onEvent?.({
        type: "policy.frozen_path_violation",
        runId: loop.runtime.runId,
        iteration,
        role: role?.id ?? "",
        files: frozenFiles,
      });
      clean.frozenViolated = true;
      clean.frozenViolations = [{ role: role?.id ?? "", files: frozenFiles }];
      clean.frozenReverts = reverted;
    }
  }

  // Ralph-parity audit: git-diff vs HEAD, observational, restricted roles only.
  if (auditEnabled && role && isGitRepo(loop.paths.workDir)) {
    const files = changedFiles(loop.paths.workDir);
    if (files.length > 0) {
      const reason: FileModViolationReason | null = role.readOnly
        ? "read_only"
        : (role.disallowedTools?.length ?? 0) > 0
          ? "disallowed_tools"
          : null;
      if (reason) {
        appendEvent(
          loop.paths.journalFile,
          loop.runtime.runId,
          String(iteration),
          "policy.file_modification_violation",
          `${jsonField("role", role.id)}, ${jsonField("files", files.join(","))}, ${jsonField("reason", reason)}`,
        );
        loop.onEvent?.({
          type: "policy.file_modification_violation",
          runId: loop.runtime.runId,
          iteration,
          role: role.id,
          files,
          reason,
        });
        clean.violated = true;
        clean.violations = [{ role: role.id, files, reason }];
      }
    }
  }

  return clean;
}
