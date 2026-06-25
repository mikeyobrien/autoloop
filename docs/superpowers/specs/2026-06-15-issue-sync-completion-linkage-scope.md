# Issue-sync push-back: completion linkage — scope

**Date:** 2026-06-15
**Status:** **Superseded 2026-06-16.** The commit-text / branch-match inference and
run-start SHA tracking described below were **removed** in favour of reading task
**status** directly: `push` transitions issues whose run-queue task is `done`, and the
loop's completion gate (fixed to honor the run-scoped `AUTOLOOP_TASKS_FILE`) forces the
agent to `autoloop task complete <id>` each pulled issue before the run can end. `--final`
is gone (push always behaves the same); `push --release` promotes In Review → Done.
See `packages/linear-sync/README.md` for the current model.
**Repo:** `jsamuel1/autoloop` · builds on `feat/issue-sync-bridge`

## Problem recap

A whole-queue run (`autocode` on `master`, working pulled Linear issues) finishes the
work but never moves the issues, because:

- **autocode has no per-queue-task completion.** `task.complete` is the **run-ending
  event** the finalizer emits — not `autoloop task complete <id>` per pulled issue.
  Pulled Linear tasks sit in `tasks.jsonl` as *context only*; they are never marked
  `done`. So `push`'s `listDone()` never returns them → `transitioned 0`.
- **Branch-based `push --final`** (already built) only matches a run that ran **on the
  issue's branch**. A whole-queue run on `master` matches no `branchName` → transitions
  nothing. (Verified: state has SAU‑13…22 mapped with `jsamuel/sau-NN-…` branches; run
  was on `master`.)

## Two flows to support

### A. Per-issue flow — BUILT (scope = harden + document)

`autoloop-linear-open` checks out `issue.branchName`; the run works that one issue; on
`post_run`, `push --final` transitions the mapped issue whose `branchName == ` the run's
current branch, **gated on `AUTOLOOP_STOP_REASON == "completed"`**.

Status: implemented + unit-tested. Remaining scope:
- **Hardening:** `autoloop-linear-open` should fail loudly if branch checkout fails or the
  tree is dirty; today it falls back to the current branch silently.
- **Optional tightening:** require ≥1 commit on the branch before transitioning (so a
  completed-but-no-op run doesn't move the issue). Today the gate is "run completed";
  this would make it "run completed **and** work landed." (Decision below.)
- **Docs:** the per-issue UX is only in the design doc; add a short README/runbook.

### B. Whole-queue flow — TO BUILD (recommended: commit-reference detection)

Because autocode commits per slice but never marks queue tasks done, the reliable signal
that an issue was worked is **a commit that references it**.

**Mechanism:** on `push --final` after a **completed** run, for each mapped, not-yet-In-
Review issue, transition it to In Review if a commit in the run's range references it.
"References it" = the commit subject/body contains the issue **identifier** (`SAU-22`) or
the commit is on the issue's `branchName`. (Linear's own magic words — "Fixes SAU-22" —
are a superset and keep Linear's native git-linking working too.)

**Run range (which commits count):** capture run-start `HEAD` in the `pre_run` hook
(store `runStartSha` keyed by run id in the sync state, or a small per-run file);
`push --final` scans `git log <runStartSha>..HEAD --format=%s%n%b`. Fallback when no
start sha: commits on the current branch not on the repo's default branch.

**Gating:** identical to branch-based — only when `AUTOLOOP_STOP_REASON == "completed"`
and `--final`. A timed-out/failed run transitions nothing.

**Requirement:** commits must reference the issue id. Enforced via the objective prompt
("reference the Linear identifier, e.g. `SAU-22`, in each commit") — already good practice
and what Linear's git integration expects. Documented as a precondition.

## Alternatives considered (and why not)

- **Per-task completion** (loop marks the pulled task `done`): rejected — autocode has no
  per-queue-task completion; its model is one objective per run, ended by the
  `task.complete` *event*. Forcing per-task completion fights the preset.
- **Loop self-reports** via an explicit `push --issue <id>` call when it finishes each
  issue: fragile for multi-issue runs (the loop has no reliable per-issue boundary).
  Fine only for the single-issue case — which is exactly the per-issue flow.

## Unified design

Both flows become one **"reference-based transition, gated on completion"** path:

- **per-issue:** reference = current branch `==` issue `branchName`.
- **whole-queue:** reference = a commit in the run range mentions the issue identifier
  (or its branch).

`push --final` collects matched issues from both signals, dedups by external id, and
transitions each once to In Review with a notes comment (run id, branch, the matching
commit SHAs).

## Acceptance criteria

- A completed whole-queue run whose commit `fix: … (SAU-22)` references SAU‑22 →
  SAU‑22 → In Review, with a comment citing the commit. Other pulled issues with no
  referencing commit stay in Todo.
- A failed/timed-out run → no transition (gate holds).
- The per-issue flow still transitions via branch match (unchanged).
- `release --repo <x> <ver>` still promotes In Review → Done (unchanged).

## Implementation sketch (one commit, small–medium)

1. **pre_run** (harness or the CLI's `pull`): record `runStartSha` for the run.
2. **CLI does the git** (keep core git-free): in `push --final`, gather commit
   subjects/bodies in the run range, compute `matchedExternalIds` (identifier substring
   or branch match against state entries).
3. **issue-sync-core `push`**: accept the precomputed `matchedExternalIds` (alongside the
   existing `currentBranch`/`branchBased`), transition those + branch-matched + task-done,
   dedup.
4. **Unit tests** (fake adapter, injected commit list): id-in-commit match, branch match,
   no-match, failed-run gate, dedup across signals.
5. **Docs:** update the design doc's status model + examples; note the "reference the id
   in commits" precondition.

## Decisions (resolved 2026-06-15)

- **D1 — per-issue gate:** **Completed AND commits landed.** Transition only when the run
  completed AND ≥1 commit exists in the run range. (CLI sets `branchBased` true only when
  commits landed.)
- **D2 — match strictness:** **Closing-keyword or tagged form** (revised in the
  2026-06-15 refactor — the original word-bounded *substring* matched bare mentions like
  "see SAU-19" and was a false-positive smell). `closedExternalIds` now matches only
  `fixes/closes/resolves <id>` or a trailing `(id)` / `[id]` tag, boundary-checked so
  `SAU-2` ≠ `SAU-22`.
- **D3 — run-range baseline:** **Capture run-start SHA at pre_run.** The CLI's `pull`
  records `HEAD` keyed by `AUTOLOOP_RUN_ID`; `push --final` reads it and scans
  `git log <startSha>..HEAD`. Works on any branch including `master`.

Architecture note: all git lives in the CLI (gather commit texts, run-start SHA via
`git rev-parse`/`git log`). Core stays git-free — `push` receives `commitTexts` +
`branchBased`/`currentBranch` and does the matching/transition (pure `closedExternalIds`).

## 2026-06-15 refactor (post-review hardening)

Roast-driven cleanup, same behaviour where correct:

- **State integrity:** `pull`/`push`/`release` now run their load-modify-save under a
  `withStateLock` file lock (parallel runs share a checkout) and write atomically
  (temp+rename). Per-issue `try/catch` means one failing tracker call no longer aborts the
  batch or strands local state behind Linear — successes persist, failures retry next run.
- **Run-start lives in the state file** (`state.runStart`), not a separate
  `issue-sync-runstart.json`; `recordRunStart`/`takeRunStart` (consume-on-read) replace the
  per-CLI prune/cap logic. One file, one lock.
- **De-duplication:** `createJsonlTasksApi` + run-start helpers moved into core; the two
  CLIs dropped ~260 lines of copy-paste (322→189, 285→156).
- **False-positive fix:** matcher tightened (D2 above).
- **Manual `push --final`** transitions on branch-match again (explicit operator intent;
  the commits-landed gate now applies only to hook runs that carry a run id).
- **`release --no-archive`** opt-out; branch deletion skips the current branch and reports
  kept-vs-deleted instead of failing silently.

## Cleanup automation (shipped 2026-06-15)

Automatic cleanup of what's now done:

- **Run-start file pruning** — `push --final` drops its run's entry from
  `.autoloop/issue-sync-runstart.json`, and `pull` caps the file to the most recent 50
  runs, so the file (added for commit-range scanning) can't grow unbounded.
- **Stuck-run reconcile** — `autoloop runs clean --reconcile` marks runs still recorded
  `running` whose OS process is gone (`isProcessAlive`) as `stopped` (append-only
  registry write). Fixes the rot `doctor` detects but couldn't fix. Run dirs then become
  eligible for the existing age-based `runs clean`.
- **Merged-branch deletion** — `release` deletes each promoted issue's per-issue branch
  locally with `git branch -d` (safe — only removes if merged; remote branches untouched).
- **Done-issue archive** — `release` archives each promoted issue via the adapter
  (`TrackerAdapter.archiveIssue?`): Linear `client.archiveIssue`; GitHub omits it (issues
  are already closed on Done). Pairs with Linear's workspace-level auto-archive setting.
