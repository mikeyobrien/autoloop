import { jsonField } from "@mobrienv/autoloop-core";
import { appendEvent } from "@mobrienv/autoloop-core/journal";
import { changedFiles, isGitRepo } from "./git-diff.js";
import type { IterationContext } from "./prompt.js";
import type { LoopContext } from "./types.js";

export type FileModViolationReason = "disallowed_tools" | "read_only";

export interface FileModViolation {
  role: string;
  files: string[];
  reason: FileModViolationReason;
}

export interface FileModAuditResult {
  ran: boolean;
  violated: boolean;
  violations: FileModViolation[];
}

/**
 * Ralph-parity emit-boundary audit (opt-in via `event_loop.audit_file_mods`).
 * Compares the working tree against HEAD after every iteration; if the
 * single acting role (`iter.allowedRoles[0]`, the same convention used for
 * per-role backend overrides) declares `disallowedTools`/`readOnly` and
 * files changed during the iteration, journals + emits a typed
 * `policy.file_modification_violation` event carrying the role and file
 * list. Purely observational: the harness itself never stops or rejects
 * completion on this result — it exists for parent orchestrators to react to.
 *
 * No-ops (returns `{ ran: false, ... }`) when the policy is disabled, and
 * `{ ran: true, violated: false, ... }` outside a git work tree, when no
 * files changed, when the acting role is ambiguous/unknown, or when the
 * acting role has no file-mutation restriction.
 */
export function runFileModAudit(
  loop: LoopContext,
  iter: IterationContext,
  iteration: number,
): FileModAuditResult {
  if (!loop.policy?.fileModAudit) {
    return { ran: false, violated: false, violations: [] };
  }
  const workDir = loop.paths.workDir;
  if (!isGitRepo(workDir)) {
    return { ran: true, violated: false, violations: [] };
  }

  const files = changedFiles(workDir);
  if (files.length === 0) {
    return { ran: true, violated: false, violations: [] };
  }

  // Autoloop runs a single backend per iteration; allowedRoles[0] is the
  // acting role for this turn (same convention prompt.ts uses to resolve
  // per-role backend overrides). Ambiguous/empty routing is skipped rather
  // than guessed, to avoid false-positive violations.
  if (iter.allowedRoles.length !== 1) {
    return { ran: true, violated: false, violations: [] };
  }
  const roleId = iter.allowedRoles[0];
  const role = loop.topology.roles.find((r) => r.id === roleId);
  if (!role) {
    return { ran: true, violated: false, violations: [] };
  }

  const reason: FileModViolationReason | null = role.readOnly
    ? "read_only"
    : (role.disallowedTools?.length ?? 0) > 0
      ? "disallowed_tools"
      : null;
  if (!reason) {
    return { ran: true, violated: false, violations: [] };
  }

  const violation: FileModViolation = { role: roleId, files, reason };
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "policy.file_modification_violation",
    `${jsonField("role", roleId)}, ${jsonField("files", files.join(","))}, ${jsonField("reason", reason)}`,
  );
  loop.onEvent?.({
    type: "policy.file_modification_violation",
    runId: loop.runtime.runId,
    iteration,
    role: roleId,
    files,
    reason,
  });
  return { ran: true, violated: true, violations: [violation] };
}
