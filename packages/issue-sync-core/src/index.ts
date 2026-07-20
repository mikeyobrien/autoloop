export type { CreateIssueInput, Issue, TrackerAdapter } from "./adapter.js";
export type { IssueSyncConfig } from "./config.js";
export { defaultConfig } from "./config.js";
export type { NoteContext, TaskLike, TasksApi } from "./operations.js";
export { createJsonlTasksApi, pull, push, release } from "./operations.js";
export type { IssueSyncPathEnv, IssueSyncPaths } from "./paths.js";
export { resolveIssueSyncPaths } from "./paths.js";
export type { SyncEntry, SyncState } from "./state.js";
export {
  findByExternalId,
  findByTaskId,
  loadState,
  saveState,
  upsertEntry,
  withStateLock,
} from "./state.js";
