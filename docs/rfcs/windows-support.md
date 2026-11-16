# RFC: Native Windows Support (Phase 1: Git for Windows shell)

**Slug:** `windows-support`  
**Status:** Draft  
**Date:** 2026-11-13  
**Phase:** Implementation  
**Depends on:** none

---

## Summary

Make `autoloop` install, build, test, and run loops on native Windows
(PowerShell or Git Bash, no WSL). Phase 1 keeps the existing POSIX shell
runtime and runs it through the `sh.exe` of Git for Windows. It replaces
the POSIX-only process primitives (process-group kills, `SIGUSR1`, `/tmp`,
`/bin/sh` literals, POSIX quoting given to `cmd.exe`) with platform-aware
helpers. Behavior on Linux and macOS does not change.

## Motivation

Baseline on Windows 11, Node 24.22.2, Git for Windows 2.x, commit `d6bb7b0`:

| Check | Result |
|---|---|
| `npm ci`, `npm run build`, `autoloop --help`, `autoloop loops` | pass |
| `autoloop run autocode "say hi" -b "node dist/testing/mock-backend.js"` | fails: `command spawn error: spawn /bin/sh ENOENT` |
| `vitest run` | 2691 tests, 2527 pass, **160 fail**, 4 skip |
| `npm ci` on Node 27 (alpha) | fails: no `node-pty` prebuild (hard dependency of the CLI through kanban) |

Main causes of the 160 failures: `spawn /bin/sh`, POSIX `'...'` quoting in
`git worktree add` commands that `execSync` gives to `cmd.exe`, hard-coded
`/tmp` and `/` path assertions, symlink `EPERM`, and `SIGUSR1`.

Verified Node behavior on Windows (Node 24): `process.on("SIGUSR1", fn)`
registers without error, but no process can deliver it;
`process.kill(pid, "SIGUSR1")` throws `ERR_UNKNOWN_SIGNAL`.
`process.kill(-pid, sig)` (process group) is not supported.

## Goal

A Windows user with Node >= 20 and Git for Windows can run
`npm install -g @mobrienv/autoloop` (or build from source) and then run
`autoloop run <preset> "<prompt>"` with a command, claude, codex, or pi
backend. Interrupts, timeouts, and worktree isolation work.

## Scope

1. A platform helper module in `@mobrienv/autoloop-core`
   (`packages/core/src/platform.ts`):
   - `resolvePosixShell(env?)`: `/bin/sh` on POSIX. On win32, the first hit of:
     `AUTOLOOP_SHELL`; `sh.exe` under the Git install root found from
     `git --exec-path`; `%ProgramFiles%\Git\bin\sh.exe`;
     `%LOCALAPPDATA%\Programs\Git\bin\sh.exe`; `sh.exe`/`bash.exe` on `PATH`
     (never `%SystemRoot%\System32\bash.exe`, which is WSL). The result is cached.
   - `PosixShellNotFoundError` with an actionable message that names Git for
     Windows and `AUTOLOOP_SHELL`.
   - `killProcessTree(pid, signal)`: `process.kill(-pid, signal)` on POSIX;
     `taskkill /PID <pid> /T /F` on win32.
   - `canSignalUsr1()`: `false` on win32.
   - `processGroupSpawnOptions()`: `{ detached: true }` on POSIX;
     `{ detached: false, windowsHide: true }` on win32.
2. Backends (`packages/backends`): use the resolved shell instead of
   `/bin/sh`; use `killProcessTree` for timeouts and session teardown
   (run-command, acp-client, pi-rpc-client); spawn `.cmd`/`.bat` provider
   shims (`claude`, `codex`, `npx`, `pi`) correctly on win32. On win32, give
   the generated backend script to the shell as a temporary script file, not as
   a `-c` argument. Reason (measured): the wrapper script holds the full prompt
   (23,065 characters for a small `autocode` run), the Windows command line has
   a limit of 32,767 characters (`ENAMETOOLONG` at 40,000), and the MSYS
   command-line parser breaks the script when it has non-ASCII text such as `—`
   (`unexpected EOF while looking for matching '`); the same script passes from
   a file.
3. Harness and CLI (`packages/harness`, `packages/cli`):
   - every `shell: "/bin/sh"` and `spawn("/bin/sh", ...)` uses the resolved shell;
   - generated tool and pi-adapter scripts keep their `#!/bin/sh` form; on
     win32 also write a `<name>.cmd` sibling that runs the script through
     the resolved shell, so PowerShell- and cmd-based agents can call them;
     `AUTOLOOP_BIN` stays the POSIX script path;
   - `/tmp` defaults use `os.tmpdir()`;
   - live control on win32: `control interrupt|abandon` does not send
     `SIGUSR1`; the running harness drains the durable control queue with a
     timer (interval <= 1 s) instead. Cooperative interrupt of the backend child
     is not available on win32; the harness goes directly to the
     terminate step of its escalation;
   - `autoloop doctor` reports the resolved shell, or the
     `PosixShellNotFoundError` message on win32.
4. Core (`packages/core`): git commands in `worktree/*` use
   `execFileSync("git", [...args])` (no shell string), so paths with spaces
   and backslashes work on all platforms; fix path handling that assumes `/`.
5. Kanban: move `@homebridge/node-pty-prebuilt-multiarch` to
   `optionalDependencies`; when it is missing, kanban PTY features fail with a
   clear message and the rest of the CLI works.
6. Tests: the full suite passes on Windows. A test may use
   `it.skipIf(process.platform === "win32")` only when it tests a POSIX-only
   feature (for example `SIGUSR1` forwarding or tmux). Each skip has a
   one-line reason comment. Approved deviation: the `bin/dev build` test in
   `test/integration/dev-dispatcher.test.ts` is skipped on win32, because its
   dist rebuild (about 100 s on Windows) races other CLI tests in the same
   run; AC1 covers `npm run build` on Windows.
7. Docs: a Windows section in `README.md` and in
   `docs/getting-started/` (requirements, `AUTOLOOP_SHELL`, known limits).
8. Source checkouts: a root `.gitattributes` with `* text=auto eol=lf`, so a
   Windows clone with `core.autocrlf=true` has LF files. Without it, Biome
   reports format errors on 19 files in `src/ test/`, and `#!/bin/sh` scripts
   (hooks, preset scripts) fail under `sh.exe` with `$'\r'` errors.
9. Process lookup safety on win32: Windows (libuv) looks up a bare command
   name in the current directory before `PATH` (repro: a `git.exe` placed in
   the cwd ran instead of git). New lookups in this work use absolute paths:
   `taskkill` from `%SystemRoot%\System32`, `git` for shell discovery from an
   absolute `PATH` entry, and `.exe` provider commands by their resolved path.
   One shared `PATH` lookup in `platform.ts` serves shell discovery, provider
   spawns, and `doctor`. The Git shell candidates are only `<git>\bin\sh.exe`
   (the `usr\bin\sh.exe` candidate has no `/usr/bin` on `PATH`). Bare-name
   `git` spawns that existed before this work (worktree, git-diff, kanban) are a
   follow-up.

## Exclusions (not in Phase 1)

- A native `cmd.exe`/PowerShell runtime without Git for Windows.
- Kanban terminal features on Windows (they need tmux).
- A standalone `autoloop-windows-x64.exe` release build and any change to
  `.github/workflows/*` (the repo does not run PR CI; see `docs/ci-local.md`).
- Porting the autowiki preset `*.sh` scripts (they run under the resolved shell).

## Constraints

- No behavior change on Linux and macOS: the POSIX branch of each helper
  is the code that exists today.
- Repo gates (`AGENTS.md`): `biome check src/ test/`, `tsc --noEmit`, and
  coverage >= 90% lines and branches for changed code. Do not use `--no-verify`.
- Keep `shellQuote`/`shellWords` semantics; the generated scripts still run
  in a POSIX shell.
- Node >= 18 stays the engine floor in `package.json`.

## Acceptance criteria

| ID | Criterion | Check |
|---|---|---|
| AC1 | `npm ci` and `npm run build` pass on Windows with Node 24. | exit codes |
| AC2 | `autoloop run autocode "say hi" --max-iterations 1 --no-worktree -b <wrapper>` completes an iteration without `backend_failed` on Windows; `<wrapper>` is a `#!/bin/sh` script that runs `node <repo>/dist/testing/mock-backend.js` (`-b` takes one executable on every platform). | live run log |
| AC3 | A mock backend fixture with `emit_event` records the event in the journal on Windows (the generated tool script works). | journal grep |
| AC4 | `autoloop run ... --worktree` on Windows creates the worktree and finishes; a project path with a space works. | live run log, `git worktree list` |
| AC5 | A backend timeout on Windows ends the backend child and its grandchild (no process with the test marker remains). | unit test with a node child that starts a grandchild |
| AC6 | `autoloop control interrupt <run>` on Windows stops the current iteration of a running loop and does not throw. | integration test |
| AC7 | On Windows with no POSIX shell (`AUTOLOOP_SHELL` set to a missing file and the search disabled in the test), `autoloop run` exits non-zero with the `PosixShellNotFoundError` message; `autoloop doctor` shows the shell status. | unit test, live doctor output |
| AC8 | Full `vitest run` on Windows: 0 failures. Every win32 skip has a reason comment; the final report lists the skips. | vitest JSON |
| AC9 | Full `vitest run` on Linux (Podman `node:22-bookworm-slim`): no new failures compared with the Linux baseline of `d6bb7b0`. | vitest output diff |
| AC10 | `biome check src/ test/` and `tsc --noEmit` pass; `npm run test:coverage` meets the 90% gate (run on Linux). | exit codes |
| AC11 | `npm ci` succeeds when the `node-pty` prebuild is missing (Node 27 alpha), and `autoloop --help` works after it. | exit codes |
| AC12 | README and getting-started docs have a Windows section that matches the implemented behavior. | review |
| AC13 | A fresh Windows clone with `core.autocrlf=true` has LF working files (`git ls-files --eol` shows `w/lf`), and `biome check src/ test/` passes. | command output |
| AC14 | On win32, the new process lookups never run an executable from the current directory: `taskkill` (tree kill), `git --exec-path` (shell discovery), and provider commands that `resolveSpawnTarget` finds as `.exe`. A planted `git.exe`/`taskkill.exe` in the cwd does not run. | win32 tests in `platform.test.ts` and `spawn-target.test.ts` |

## Implementation

| Area | Files | Acceptance |
|---|---|---|
| Platform helpers | `packages/core/src/platform.ts` (`resolvePosixShell`, `killProcessTree`, `findOnWindowsPath`, `canSignalUsr1`, `processGroupSpawnOptions`); worktree git calls with argv | AC7, AC13, AC14 |
| Backends | `packages/backends/**`: resolved shell, temp script file, tree kill, `.cmd` shims through `cmd.exe`, `Path` key, stdin EPIPE | AC2, AC5, AC14 |
| Harness and CLI | `packages/harness/**`, `packages/cli/**`: resolved shell for hooks and gates, `.cmd` tool siblings, forward-slash tool paths in prompts, win32 control poll, `doctor` shell check, `run`/`resume` preflight | AC3, AC6, AC7 |
| Kanban, dashboard | optional `node-pty`, clear tmux message, hidden detached runs | AC11 |
| Tests and docs | portable root tests, `.gitattributes`, vitest forks cap on win32, README and install guide | AC1, AC4, AC8 to AC10, AC12 |

## Known limits (Phase 1)

- Timed gate commands use `spawnSync`/`execSync` with `timeout`
  (`harness/src/acceptance.ts`, `intent.ts`, `postfire-verify.ts`,
  `progress.ts`, `notify.ts`; also `backends/src/run-command.ts`
  `runShellCommand`). On win32 the resolved `<git>\bin\sh.exe` is a launcher
  for `usr\bin\bash.exe`. The timeout ends only the launcher. A command that
  never ends can hang the harness (measured: a shell busy loop with stdin input
  hangs; `sleep 5` returns when it ends). Running `usr\bin\sh.exe` directly is
  not a fix: `/usr/bin` is then not on `PATH` (`cut: command not found`).
  Follow-up: an async runner that kills the process tree on timeout. The one
  test for this (`notify.test.ts`, notify timeout) is skipped on win32.
- Cooperative interrupt (`SIGUSR1`) does not exist on win32. `control
  interrupt` ends the backend process tree instead.
- On win32 the 1 s control poll leaves `respond` requests for the human-ask
  wait. A `respond` with no matching ask stays pending (on POSIX it is
  acknowledged as `ignored`).
- A backend timeout or interrupt on win32 ends native Windows programs in the
  backend tree (for example `node`, `claude`, `codex`) with `taskkill /T`.
  MSYS utilities that bash forks (for example `sleep` from Git for Windows) are
  not in the Windows process tree, so `taskkill /T` does not reach them; the
  run then waits until such a utility ends. Measured: `( sleep 30 ) & wait $!`
  takes 30.6 s with a 200 ms timeout, before and after Phase 1.
- Git Bash (MSYS) can change backslashes in arguments that it gives to native
  programs, for example `node -e "...\\..."` in a backend command.
- Bare-name lookups that existed before this work still search the current
  directory first on win32: `git` spawns in worktree, git-diff, and kanban
  code, and a provider command that is not on `PATH` (or is found as `.ps1`,
  `.js`, and similar). Follow-up: fail with ENOENT when the absolute lookup
  finds nothing, and resolve `git` once by absolute path.

## Open questions

- Phase 2 can add a native PowerShell runtime if Git for Windows is not
  acceptable as a requirement.
- Upstream acceptance of the Git for Windows requirement is not known.
