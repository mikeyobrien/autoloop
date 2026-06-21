# @mobrienv/autoloop-linear-sync

Sync Linear issues ↔ an autoloop task queue, wired as **run hooks** so a loop pulls
ready work at the start and pushes completion back to Linear at the end.

Ships two bins:

- **`autoloop-linear-sync`** — the `pull` / `push` / `release` CLI used by the hooks.
- **`autoloop-linear-open`** — a launcher for Linear's "open in coding tool" feature
  (wires the hooks for you; see that script for a reference invocation).

Requires **`LINEAR_API_KEY`** in the environment. autoloop does not manage secrets — if a
GUI-triggered launch doesn't inherit your login shell, export it yourself (e.g.
`launchctl setenv`) or wrap the launcher.

## CLI

```
autoloop-linear-sync <pull|push|release> [options]
  pull                                Pull Linear issues into the task queue
  push [--release] [--no-archive]     Move completed tasks' issues to In Review;
                                      --release also promotes In Review → Done
  release <version> [--no-archive]    Promote In-Review issues to Done
```

## How completion is detected: task **status**, not git commits

`push` transitions an issue when its task is **done** in the run's task queue —
i.e. the agent ran `autoloop task complete <id>`. It does **not** parse commit
messages or match branches. This makes it reliable for whole-queue, main-branch
development where there are no per-issue branches and commit phrasing varies.

The loop's **completion gate** enforces this: a run cannot emit its completion
event while open (non-soft) tasks remain, so the agent must explicitly complete
each pulled issue before finishing. Those completions are exactly what `push`
reads back.

## Hook wiring (the important part)

Wire the bins as autoloop hooks. The minimal correct set is **`pre_run` pull** +
**`post_run` push**:

```bash
autoloop run -b claude-sdk autocode \
  --set hooks.pre_run="autoloop-linear-sync pull" \
  --set hooks.post_run="autoloop-linear-sync push" \
  "Work the Linear-pulled tasks. Run \`autoloop task complete <id>\` as you finish each one."
```

| Hook | Command | Effect |
|---|---|---|
| `pre_run` | `autoloop-linear-sync pull` | Pull `Todo` issues into the run's task queue. |
| `post_run` | `autoloop-linear-sync push` | Move every issue whose task is **done** to **In Review**. Safe to also run at `post_iteration` (idempotent). |

Promotion to **Done** happens with `--release` (or the standalone `release`):

```bash
autoloop-linear-sync push --release                # done → In Review, then In Review → Done (archives)
autoloop-linear-sync push --release --no-archive   # same, but leave issues unarchived
autoloop-linear-sync release <version>             # In Review → Done with a version comment + branch cleanup
```

## Gotchas

- **Nothing moves unless tasks are marked done.** The signal is task status —
  the agent must `autoloop task complete <id>` for each finished issue. The
  completion gate forces this before the run can end.
- **`push` (no flag) only reaches "In Review".** Use `--release` (or `release`)
  to reach **Done**.
- **A killed/timed-out run skips `post_run`.** Re-run `autoloop-linear-sync push`
  by hand afterward to sync whatever was completed.
- Config lives in the consuming project's `.autoloop/issue-sync.toml`
  (`project`, `team`, `repo_label`, `pull_states`, `review_state`, `done_state`).

## See also

- `bin/autoloop-linear-open` — reference launcher (wires the hooks; GUI-triggered).
- `docs/superpowers/specs/2026-06-14-autoloop-issue-sync-design.md` — design/lifecycle.
