export type { CleanOpts, CleanResult } from "./clean.js";
export { cleanWorktrees } from "./clean.js";
export type { CreateWorktreeOpts, CreateWorktreeResult } from "./create.js";
export {
  createWorktree,
  resolveGitRoot,
  tryResolveGitRoot,
} from "./create.js";
export type { WorktreeListEntry } from "./list.js";
export { listWorktreeMetas } from "./list.js";
export type { MergeOpts, MergeResult } from "./merge.js";
export { mergeWorktree } from "./merge.js";
export type { WorktreeMeta, WorktreeStatus } from "./meta.js";
export {
  isOrphanWorktree,
  metaDirForRun,
  readMeta,
  updateStatus,
  writeMeta,
} from "./meta.js";
