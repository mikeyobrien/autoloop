// Persistent task store, ralph-orchestrator style:
//   - One JSONL file per scope at <autoloopHome>/tasks/<encoded-scope>/tasks.jsonl
//     (scope precedence: git root → cwd — see ./workspace.ts).
//     Tasks created with scope="global" land under tasks/_global/.
//   - One JSON object per line (append-friendly, greppable, diff-friendly).
//   - Each task still carries a `scope` field for debuggability + to key
//     global tasks. File-on-disk determines membership; the field is a
//     redundant self-description.
//   - All reads/writes guarded by an O_EXCL lockfile so concurrent autoloop
//     sessions can share the file safely.
//   - Test mode: pass `opts.path` (and optionally `archivePath`) to pin the
//     store to a single file pair — preserves existing tests that want a
//     deterministic on-disk layout.

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { autoloopHome } from "./paths.js";
import { detectScope } from "./workspace.js";

export type TaskStatus = "open" | "in_progress" | "closed" | "failed";

/** Kanban column for UI grouping. Orthogonal to `status` (the agent-facing
 *  state the task_* tools manipulate). The 5 visible columns are the main
 *  board; the hidden columns are end-state buckets surfaced via a toggle. */
export type KanbanColumn =
  | "backlog"
  | "in_progress"
  | "human_review"
  | "rework"
  | "merging"
  | "done"
  | "cancelled"
  | "duplicate";

export const VISIBLE_COLUMNS: KanbanColumn[] = [
  "backlog",
  "in_progress",
  "human_review",
  "rework",
];

export const HIDDEN_COLUMNS: KanbanColumn[] = [
  "merging",
  "done",
  "cancelled",
  "duplicate",
];

/** Runtime state of the dashboard-spawned autoloop run attached to a task.
 *  Orthogonal to `status` (the kanban lane): a task can sit in `in_progress`
 *  with autoloop.state=`detached`, meaning the worker PTY has exited but the
 *  run is intact and can be reattached by run_id. */
export type TaskAutoloopState =
  | "running"
  | "idle"
  | "paused"
  | "crashed"
  | "detached";

/** How the task's working tree is materialised. `direct` = agent edits the
 *  scope path in place (default, matches legacy behaviour). `worktree` =
 *  agent runs against a git worktree rooted elsewhere on disk; see
 *  `Task.worktree` for the path + branch. */
export type WorkspaceKind = "direct" | "worktree";

export interface TaskWorktree {
  /** Absolute path to the git worktree checkout. */
  path: string;
  /** Branch name checked out in the worktree. */
  branch: string;
  /** Ref the worktree branched from (sha or branch name). */
  base_ref: string;
  /** ISO timestamp stamped when the worktree was created. */
  created: string;
  /** When set, worktree was kept around after the task ended — the string
   * explains why (e.g. "dirty tree", "user opted in") so the cleanup sweeper
   * can surface it in UI. */
  preserved_reason?: string;
}

export interface TaskAutoloop {
  state: TaskAutoloopState;
  /** Run id for reattaching to the autoloop run. Stable across PTY restarts. */
  run_id: string;
  /** cwd the worker spawned with. Captured so later respawns land in the
   * same directory even if the user's shell moved. */
  workspace: string;
  pid?: number;
  started: string;
  last_active: string;
  exit_code?: number;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  /** Stable user-supplied key for idempotent upsert (ensure). */
  key?: string;
  status: TaskStatus;
  /** 1 (highest) .. 5 (lowest). Clamped. */
  priority: number;
  blocked_by: string[];
  /** Scope key — typically an absolute path (git / cwd). Use "global" to pin
   * a task visible from every workspace. */
  scope: string;
  /** How the working tree is materialised. Absent ⇒ "direct" (legacy cards
   * pre-date this field). Only "worktree" cards carry a populated
   * `worktree` block. */
  workspace_kind?: WorkspaceKind;
  /** Populated when workspace_kind === "worktree". Captures the checkout
   * path + branch so the dashboard/cleanup tools don't have to re-derive
   * them from git. */
  worktree?: TaskWorktree;
  /** User intent flag: when true, the spawn path should materialise a git
   * worktree on first start instead of running the agent in the scope path
   * directly. Independent of `workspace_kind` — this is the opt-in,
   * workspace_kind records what actually got materialised. */
  worktree_opt_in?: boolean;
  /** Autoloop preset to invoke when spawning. Falls back to the kanban
   * config's defaultPreset at spawn time when unset. */
  preset?: string;
  /** Creating run id, informational only. */
  run_id?: string;
  created: string;
  started?: string;
  closed?: string;
  /** Kanban column. Independent of `status`. Defaults to "backlog" for new
   * tasks. Moving a card to `done` or `cancelled` also transitions `status`
   * to closed/failed so the agent-facing tools see it end-of-life too. */
  column?: KanbanColumn;
  /** Dashboard-spawned worker state. Undefined means no PTY has ever been
   * opened for this task. See TaskAutoloop / TaskAutoloopState. */
  autoloop?: TaskAutoloop;
  /** Latest in-flight status note left by the agent via `task_comment`.
   * Latest-wins (replace, not stack). Auto-cleared when the card leaves
   * `in_progress` (see setColumn). Rendered as a single italic line under
   * the card title on the kanban board. */
  comment?: { text: string; at: string };
}

export interface TaskListFilter {
  /** Exact scope match. Use "all" to skip filter, "global" for global-only. */
  scope?: string;
  status?: TaskStatus | TaskStatus[];
  /** When true, include closed+failed. Shorthand for status filter. */
  includeDone?: boolean;
}

const DEFAULT_ROOT = () => join(autoloopHome(), "tasks");
const TASKS_FILENAME = "tasks.jsonl";
const ARCHIVE_FILENAME = "tasks_archive.jsonl";
const GLOBAL_SCOPE = "global";
const GLOBAL_DIRNAME = "_global";
const LOCK_SUFFIX = ".lock";
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_POLL_MS = 25;

// --- locking ---------------------------------------------------------------

function acquireLock(path: string): () => void {
  const lockPath = path + LOCK_SUFFIX;
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      const fd = openSync(lockPath, "wx");
      closeSync(fd);
      return () => {
        try {
          unlinkSync(lockPath);
        } catch {
          /* already gone */
        }
      };
    } catch (err: any) {
      if (err?.code !== "EEXIST") throw err;
      if (Date.now() > deadline) {
        // Stale lock: nuke and retry once. 5s is well past any legitimate
        // read-modify-write window; if we're past it, a prior autoloop crashed.
        try {
          unlinkSync(lockPath);
        } catch {
          /* race ok */
        }
        continue;
      }
      // Busy wait — node has no sleep primitive sync, so spin.
      const until = Date.now() + LOCK_POLL_MS;
      while (Date.now() < until) {
        /* spin */
      }
    }
  }
}

function withLock<T>(path: string, fn: () => T): T {
  const release = acquireLock(path);
  try {
    return fn();
  } finally {
    release();
  }
}

// --- serialization ---------------------------------------------------------

function readAll(path: string): Task[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf-8");
  const out: Task[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as Task);
    } catch {
      /* skip corrupt line, don't lose the rest */
    }
  }
  return out;
}

function writeAll(path: string, tasks: Task[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const body =
    tasks.map((t) => JSON.stringify(t)).join("\n") + (tasks.length ? "\n" : "");
  writeFileSync(tmp, body, "utf-8");
  renameSync(tmp, path);
}

// --- per-scope path routing ------------------------------------------------
//
// A scope is typically an absolute POSIX path (git root / cwd). Encode it
// into a single directory under the tasks root by mirroring its path
// structure verbatim — keeps files human-greppable and obvious in a
// `tree ~/.autoloop/tasks` listing. `/a/b/c` → `tasks/a/b/c/tasks.jsonl`.
// The special literal "global" lands under `_global` so it can't collide
// with a user path at filesystem root.

function encodeScope(scope: string): string {
  if (!scope || scope === GLOBAL_SCOPE) return GLOBAL_DIRNAME;
  const abs = resolvePath(scope);
  const stripped = abs.replace(/^[/\\]+/, "");
  return stripped || GLOBAL_DIRNAME;
}

function scopeDir(root: string, scope: string): string {
  return join(root, encodeScope(scope));
}

function tasksFileFor(root: string, scope: string): string {
  return join(scopeDir(root, scope), TASKS_FILENAME);
}

function archiveFileFor(root: string, scope: string): string {
  return join(scopeDir(root, scope), ARCHIVE_FILENAME);
}

/** Enumerate every tasks.jsonl (or tasks_archive.jsonl) under the root. Used
 * for scope="all" reads and id-lookups. Returns paths that exist; missing
 * root returns []. */
function walkScopeFiles(root: string, filename: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && e.name === filename) {
        out.push(full);
      }
    }
  }
  return out;
}

// --- id ---------------------------------------------------------------------

function newId(): string {
  const ts = Math.floor(Date.now() / 1000);
  const rand = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, "0");
  return `task-${ts}-${rand}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampPriority(p: number | undefined): number {
  if (p == null || Number.isNaN(p)) return 3;
  return Math.min(5, Math.max(1, Math.floor(p)));
}

// --- store ------------------------------------------------------------------

export interface TaskStoreOptions {
  /** Legacy/test override: pin every scope to the same jsonl file. When set,
   * disables the per-scope layout entirely. Primarily for existing tests. */
  path?: string;
  /** Legacy/test override for archive file. Pair with `path`. */
  archivePath?: string;
  /** Root dir for per-scope files (<root>/<encoded-scope>/tasks.jsonl).
   * Default: <autoloopHome>/tasks. Ignored when `path` is set. */
  rootDir?: string;
  /** Resolver for the default scope when none is passed (tests / DI). */
  scopeResolver?: () => string;
  /** Run id stamped on created tasks. */
  runId?: string;
}

export interface ArchiveFilter {
  /** Exact scope match. "all" = every scope. Default: current scope. */
  scope?: string;
  /** Only archive tasks closed/failed at least this many days ago.
   * Undefined = no age gate (archive every closed/failed match). */
  olderThanDays?: number;
}

export interface ArchiveResult {
  archived: Task[];
  count: number;
}

export class TaskStore {
  /** When set: single-file legacy mode. All scopes share these paths. */
  private readonly pinnedPath?: string;
  private readonly pinnedArchivePath?: string;
  private readonly rootDir: string;
  private readonly scopeResolver: () => string;
  private readonly runId?: string;

  constructor(opts: TaskStoreOptions = {}) {
    this.pinnedPath = opts.path;
    this.pinnedArchivePath =
      opts.archivePath ?? (opts.path ? undefined : undefined);
    this.rootDir = opts.rootDir ?? DEFAULT_ROOT();
    this.scopeResolver = opts.scopeResolver ?? (() => detectScope());
    this.runId = opts.runId;
  }

  /** Tasks file for a given scope (or the current scope). Respects pinned
   * single-file mode. */
  fileFor(scope?: string): string {
    if (this.pinnedPath) return this.pinnedPath;
    return tasksFileFor(this.rootDir, scope ?? this.scopeResolver());
  }

  /** Archive file for a given scope (or the current scope). */
  archiveFileFor(scope?: string): string {
    if (this.pinnedArchivePath) return this.pinnedArchivePath;
    if (this.pinnedPath) return this.pinnedPath; // legacy: everything in one file
    return archiveFileFor(this.rootDir, scope ?? this.scopeResolver());
  }

  /** Root dir for per-scope layout (or the pinned path in legacy mode). */
  rootDirectory(): string {
    return this.pinnedPath ? dirname(this.pinnedPath) : this.rootDir;
  }

  /** Path of the archive file for the CURRENT scope — exposed so callers can
   * report it to the user. */
  archiveFile(): string {
    return this.archiveFileFor();
  }

  /** Return the scope string that would be used for new tasks. */
  currentScope(): string {
    return this.scopeResolver();
  }

  /** Enumerate every tasks.jsonl (archive=false) or tasks_archive.jsonl
   * (archive=true) in the per-scope layout. Legacy mode returns the pinned
   * file. Used for scope="all" reads and id lookups. */
  private allFiles(archive: boolean): string[] {
    if (this.pinnedPath) {
      if (archive)
        return this.pinnedArchivePath
          ? [this.pinnedArchivePath]
          : [this.pinnedPath];
      return [this.pinnedPath];
    }
    return walkScopeFiles(
      this.rootDir,
      archive ? ARCHIVE_FILENAME : TASKS_FILENAME,
    );
  }

  /** Find which file contains a given task id. Returns undefined if absent. */
  private findFileForId(id: string, archive = false): string | undefined {
    // Fast path: current scope first — that's where most transitions happen.
    const files = this.allFiles(archive);
    const current = archive ? this.archiveFileFor() : this.fileFor();
    const ordered = files.includes(current)
      ? [current, ...files.filter((f) => f !== current)]
      : files;
    for (const f of ordered) {
      if (readAll(f).some((t) => t.id === id)) return f;
    }
    return undefined;
  }

  add(input: {
    title: string;
    description?: string;
    key?: string;
    priority?: number;
    blocked_by?: string[];
    scope?: string;
    workspace_kind?: WorkspaceKind;
    worktree?: TaskWorktree;
    worktree_opt_in?: boolean;
    preset?: string;
  }): Task {
    const scope = input.scope ?? this.scopeResolver();
    const id = newId();
    const blocked_by = input.blocked_by ?? [];
    // Cycle check: a brand-new task has no dependents yet, so the only way
    // to cycle is if its own id appears in blocked_by. Belt-and-braces
    // in case a caller supplies `id` externally somewhere in the future.
    if (blocked_by.includes(id))
      throw new Error("blocked_by cycle: task cannot block itself");
    const { workspace_kind, worktree } = normalizeWorkspace(
      input.workspace_kind,
      input.worktree,
    );
    const task: Task = {
      id,
      title: input.title,
      description: input.description,
      key: input.key,
      status: "open",
      priority: clampPriority(input.priority),
      blocked_by,
      scope,
      workspace_kind,
      worktree,
      worktree_opt_in: input.worktree_opt_in || undefined,
      preset: input.preset,
      run_id: this.runId,
      created: nowIso(),
    };
    const file = this.fileFor(scope);
    withLock(file, () => {
      const tasks = readAll(file);
      tasks.push(task);
      writeAll(file, tasks);
    });
    return task;
  }

  /** Idempotent upsert by (scope, key). If a task with the same key exists in
   * the same scope, return it unchanged; otherwise create. */
  ensure(input: {
    key: string;
    title: string;
    description?: string;
    priority?: number;
    blocked_by?: string[];
    scope?: string;
    workspace_kind?: WorkspaceKind;
    worktree?: TaskWorktree;
    worktree_opt_in?: boolean;
    preset?: string;
  }): Task {
    const scope = input.scope ?? this.scopeResolver();
    const file = this.fileFor(scope);
    let result!: Task;
    withLock(file, () => {
      const tasks = readAll(file);
      const existing = tasks.find(
        (t) => t.key === input.key && t.scope === scope,
      );
      if (existing) {
        result = existing;
        return;
      }
      const id = newId();
      const blocked_by = input.blocked_by ?? [];
      if (blocked_by.includes(id))
        throw new Error("blocked_by cycle: task cannot block itself");
      const { workspace_kind, worktree } = normalizeWorkspace(
        input.workspace_kind,
        input.worktree,
      );
      const task: Task = {
        id,
        title: input.title,
        description: input.description,
        key: input.key,
        status: "open",
        priority: clampPriority(input.priority),
        blocked_by,
        scope,
        workspace_kind,
        worktree,
        worktree_opt_in: input.worktree_opt_in || undefined,
        preset: input.preset,
        run_id: this.runId,
        created: nowIso(),
      };
      tasks.push(task);
      writeAll(file, tasks);
      result = task;
    });
    return result;
  }

  get(id: string): Task | undefined {
    for (const file of this.allFiles(false)) {
      const found = readAll(file).find((t) => t.id === id);
      if (found) return found;
    }
    return undefined;
  }

  list(filter: TaskListFilter = {}): Task[] {
    const scope = filter.scope ?? this.scopeResolver();
    const files =
      scope === "all" ? this.allFiles(false) : [this.fileFor(scope)];
    const tasks: Task[] = [];
    for (const f of files) tasks.push(...readAll(f));
    return tasks.filter((t) => {
      if (scope !== "all" && t.scope !== scope) {
        // Belt-and-braces: per-scope file routing already filters by scope,
        // but keep the field check so a rogue task tagged with the wrong
        // scope can't leak across workspaces.
        return false;
      }
      if (filter.status) {
        const allowed = Array.isArray(filter.status)
          ? filter.status
          : [filter.status];
        if (!allowed.includes(t.status)) return false;
      } else if (!filter.includeDone) {
        if (t.status === "closed" || t.status === "failed") return false;
      }
      return true;
    });
  }

  private transition(
    id: string,
    apply: (t: Task) => { error?: string } | void,
  ): { task?: Task; error?: string } {
    const file = this.findFileForId(id);
    if (!file) return { error: `Task ${id} not found` };
    let result: { task?: Task; error?: string } = {};
    withLock(file, () => {
      const tasks = readAll(file);
      const t = tasks.find((x) => x.id === id);
      if (!t) {
        result = { error: `Task ${id} not found` };
        return;
      }
      const err = apply(t);
      if (err?.error) {
        result = { error: err.error };
        return;
      }
      writeAll(file, tasks);
      result = { task: t };
    });
    return result;
  }

  start(id: string) {
    return this.transition(id, (t) => {
      if (t.status === "closed") return { error: `Task ${id} already closed` };
      t.status = "in_progress";
      t.started ??= nowIso();
    });
  }

  close(id: string) {
    return this.transition(id, (t) => {
      t.status = "closed";
      t.closed = nowIso();
    });
  }

  fail(id: string) {
    return this.transition(id, (t) => {
      t.status = "failed";
      t.closed = nowIso();
    });
  }

  reopen(id: string) {
    return this.transition(id, (t) => {
      t.status = "open";
      t.closed = undefined;
    });
  }

  /** Move a single task to the archive. Task must be closed or failed;
   * otherwise returns an error so callers don't accidentally archive live
   * work. (The kanban card's archive button is only shown on done/cancelled/
   * duplicate columns, which always project to closed status.) */
  archiveOne(id: string): { task?: Task; error?: string } {
    const file = this.findFileForId(id);
    if (!file) return { error: `Task ${id} not found` };
    let result: { task?: Task; error?: string } = {};
    withLock(file, () => {
      const all = readAll(file);
      const idx = all.findIndex((t) => t.id === id);
      if (idx < 0) {
        result = { error: `Task ${id} not found` };
        return;
      }
      const t = all[idx];
      if (t.status !== "closed" && t.status !== "failed") {
        result = {
          error: `Task ${id} is ${t.status} — close or fail it before archiving`,
        };
        return;
      }
      all.splice(idx, 1);
      writeAll(file, all);
      const archivePath = this.archiveFileFor(t.scope);
      withLock(archivePath, () => {
        const archived = readAll(archivePath);
        archived.push(t);
        writeAll(archivePath, archived);
      });
      result = { task: t };
    });
    return result;
  }

  /** Move all closed/failed tasks matching filter out of tasks.jsonl into
   * tasks_archive.jsonl. Default scope = current. Pass scope="all" to sweep
   * every workspace. Age gate via olderThanDays is evaluated against the
   * task's `closed` timestamp (falls back to `created` if missing). */
  archive(filter: ArchiveFilter = {}): ArchiveResult {
    const scope = filter.scope ?? this.scopeResolver();
    const cutoff =
      filter.olderThanDays != null
        ? Date.now() - filter.olderThanDays * 86_400_000
        : null;
    const files =
      scope === "all" ? this.allFiles(false) : [this.fileFor(scope)];
    const moved: Task[] = [];
    for (const file of files) {
      withLock(file, () => {
        const all = readAll(file);
        const keep: Task[] = [];
        const localMoved: Task[] = [];
        for (const t of all) {
          const isDone = t.status === "closed" || t.status === "failed";
          const scopeMatch = scope === "all" || t.scope === scope;
          if (!isDone || !scopeMatch) {
            keep.push(t);
            continue;
          }
          if (cutoff != null) {
            const ts = Date.parse(t.closed ?? t.created);
            if (!Number.isFinite(ts) || ts > cutoff) {
              keep.push(t);
              continue;
            }
          }
          localMoved.push(t);
        }
        if (!localMoved.length) return;
        writeAll(file, keep);
        // Archive per-scope — each moved task can target a different
        // archive file when scope="all" sweeps across workspaces.
        const byArchive = new Map<string, Task[]>();
        for (const t of localMoved) {
          const ap = this.archiveFileFor(t.scope);
          const bucket = byArchive.get(ap) ?? [];
          bucket.push(t);
          byArchive.set(ap, bucket);
        }
        for (const [ap, bucket] of byArchive) {
          withLock(ap, () => {
            const archived = readAll(ap);
            writeAll(ap, [...archived, ...bucket]);
          });
        }
        moved.push(...localMoved);
      });
    }
    return { archived: moved, count: moved.length };
  }

  /** List archived tasks. Scope filter same semantics as list(): default =
   * current scope, "all" = every scope. */
  listArchived(filter: { scope?: string } = {}): Task[] {
    const scope = filter.scope ?? this.scopeResolver();
    const files =
      scope === "all" ? this.allFiles(true) : [this.archiveFileFor(scope)];
    const tasks: Task[] = [];
    for (const f of files) tasks.push(...readAll(f));
    if (scope === "all") return tasks;
    return tasks.filter((t) => t.scope === scope);
  }

  /** Move an archived task back to the active store. Status becomes "open"
   * (caller can transition further). Returns the restored task, or an error
   * if the id isn't in the archive. */
  unarchive(id: string): { task?: Task; error?: string } {
    const archiveSrc = this.findFileForId(id, true);
    if (!archiveSrc) return { error: `Task ${id} not in archive` };
    let result: { task?: Task; error?: string } = {};
    withLock(archiveSrc, () => {
      const archived = readAll(archiveSrc);
      const idx = archived.findIndex((t) => t.id === id);
      if (idx < 0) {
        result = { error: `Task ${id} not in archive` };
        return;
      }
      const [t] = archived.splice(idx, 1);
      t.status = "open";
      t.closed = undefined;
      writeAll(archiveSrc, archived);
      const liveDst = this.fileFor(t.scope);
      withLock(liveDst, () => {
        const live = readAll(liveDst);
        live.push(t);
        writeAll(liveDst, live);
      });
      result = { task: t };
    });
    return result;
  }

  /** Hard delete. Returns true if removed. */
  remove(id: string): boolean {
    const file = this.findFileForId(id);
    if (!file) return false;
    let removed = false;
    withLock(file, () => {
      const tasks = readAll(file);
      const next = tasks.filter((t) => t.id !== id);
      if (next.length === tasks.length) return;
      writeAll(file, next);
      removed = true;
    });
    return removed;
  }

  /** Patch the autoloop block on a task. Creates the block on first call.
   * `last_active` is auto-stamped. Pass `null` to clear the block entirely. */
  setAutoloop(
    id: string,
    patch: Partial<TaskAutoloop> | null,
  ): { task?: Task; error?: string } {
    return this.transition(id, (t) => {
      if (patch === null) {
        t.autoloop = undefined;
        return;
      }
      const now = nowIso();
      const existing = t.autoloop;
      if (!existing) {
        if (!patch.run_id || !patch.workspace || !patch.state) {
          return {
            error:
              "setAutoloop: initial patch requires run_id, workspace, state",
          };
        }
        t.autoloop = {
          state: patch.state,
          run_id: patch.run_id,
          workspace: patch.workspace,
          pid: patch.pid,
          started: patch.started ?? now,
          last_active: now,
          exit_code: patch.exit_code,
        };
        return;
      }
      t.autoloop = { ...existing, ...patch, last_active: now };
    });
  }

  /** Patch task title/description/priority/worktree opt-in/preset. Only fields present are overwritten. */
  patch(
    id: string,
    patch: {
      title?: string;
      description?: string;
      priority?: number;
      worktree_opt_in?: boolean;
      preset?: string;
    },
  ): { task?: Task; error?: string } {
    return this.transition(id, (t) => {
      if (typeof patch.title === "string") {
        const v = patch.title.trim();
        if (v) t.title = v;
      }
      if (typeof patch.description === "string")
        t.description = patch.description;
      if (
        typeof patch.priority === "number" &&
        patch.priority >= 1 &&
        patch.priority <= 5
      )
        t.priority = patch.priority;
      if (typeof patch.worktree_opt_in === "boolean") {
        t.worktree_opt_in = patch.worktree_opt_in || undefined;
      }
      if (typeof patch.preset === "string") {
        const v = patch.preset.trim();
        t.preset = v || undefined;
      }
    });
  }

  /** Move a task to a kanban column. Also projects onto `status` so the
   * agent-facing task_* tools observe end-of-life transitions:
   *   done/cancelled/duplicate → closed
   *   rework                    → open    (reopens for another pass)
   *   in_progress               → in_progress
   *   others                    → status unchanged
   */
  setColumn(id: string, column: KanbanColumn): { task?: Task; error?: string } {
    return this.transition(id, (t) => {
      const prevColumn = t.column;
      t.column = column;
      const now = nowIso();
      if (
        column === "done" ||
        column === "cancelled" ||
        column === "duplicate"
      ) {
        t.status = "closed";
        t.closed = t.closed ?? now;
      } else if (column === "in_progress") {
        t.status = "in_progress";
        t.started = t.started ?? now;
        t.closed = undefined;
      } else if (
        column === "rework" ||
        column === "backlog" ||
        column === "human_review" ||
        column === "merging"
      ) {
        if (t.status === "closed" || t.status === "failed") {
          t.status = "open";
          t.closed = undefined;
        }
      }
      // Stale "rebasing mainline" on a Done card is worse than nothing —
      // clear the in-flight comment as soon as the card leaves in_progress.
      if (prevColumn === "in_progress" && column !== "in_progress") {
        t.comment = undefined;
      }
    });
  }

  /** Set (or clear, when c === null) the in-flight comment on a task.
   * Replace semantics — latest-wins. Does NOT change column/status. */
  setComment(
    id: string,
    c: { text: string; at: string } | null,
  ): { task?: Task; error?: string } {
    return this.transition(id, (t) => {
      t.comment = c ?? undefined;
    });
  }

  /** Attach or patch the worktree block on a task. First call promotes the
   * task to `workspace_kind = "worktree"`. Subsequent calls patch the existing
   * block (e.g. stamping `preserved_reason` at cleanup time). Pass `null` to
   * detach — clears both `worktree` and `workspace_kind` (reverts to direct). */
  setWorktree(
    id: string,
    info: TaskWorktree | Partial<TaskWorktree> | null,
  ): { task?: Task; error?: string } {
    return this.transition(id, (t) => {
      if (info === null) {
        t.worktree = undefined;
        t.workspace_kind = undefined;
        return;
      }
      const existing = t.worktree;
      if (!existing) {
        if (!info.path || !info.branch || !info.base_ref) {
          return {
            error: "setWorktree: initial patch requires path, branch, base_ref",
          };
        }
        t.worktree = {
          path: info.path,
          branch: info.branch,
          base_ref: info.base_ref,
          created: info.created ?? nowIso(),
          preserved_reason: info.preserved_reason,
        };
      } else {
        t.worktree = { ...existing, ...info };
      }
      t.workspace_kind = "worktree";
    });
  }
}

/** Normalise the (workspace_kind, worktree) pair supplied to add()/ensure().
 *  Rules:
 *   - `worktree` block present ⇒ force workspace_kind="worktree" (can't have
 *     one without the other).
 *   - `workspace_kind === "worktree"` without a block ⇒ error — the caller
 *     must supply the block up front or use setWorktree() later.
 *   - Default: leave workspace_kind undefined so the serialized task stays
 *     minimal; readers treat undefined as "direct".
 */
function normalizeWorkspace(
  kind: WorkspaceKind | undefined,
  worktree: TaskWorktree | undefined,
): { workspace_kind?: WorkspaceKind; worktree?: TaskWorktree } {
  if (worktree) return { workspace_kind: "worktree", worktree };
  if (kind === "worktree") {
    throw new Error("workspace_kind=worktree requires a worktree block");
  }
  if (kind === "direct") return { workspace_kind: "direct" };
  return {};
}
