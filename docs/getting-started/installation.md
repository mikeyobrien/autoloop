# Installation

## Prerequisites

- Node.js >= 18
- npm

## From npm (recommended)

```bash
npm install -g @mobrienv/autoloop
```

## From source

```bash
git clone https://github.com/mikeyobrien/autoloop.git && cd autoloop
npm install
npm run build
node bin/autoloop --help
```

## Verify installation

```bash
autoloop --help
```

## Windows

autoloop runs on native Windows (PowerShell or Git Bash; no WSL). It keeps
its POSIX shell runtime and runs it through the `sh.exe` of Git for Windows.
Install from npm or from source; there is no standalone Windows binary.

### Requirements

- Node.js >= 20 (tested with Node 24)
- [Git for Windows](https://gitforwindows.org)

### Shell lookup and `AUTOLOOP_SHELL`

autoloop looks for `sh.exe` in this order:

1. `AUTOLOOP_SHELL`
2. the Git install found from `git --exec-path`
3. `%ProgramFiles%\Git`
4. `%LOCALAPPDATA%\Programs\Git`
5. `sh.exe` or `bash.exe` on `PATH` (never the WSL `bash.exe` in `System32`)

To pick a shell, set `AUTOLOOP_SHELL` to the full path of `sh.exe` or
`bash.exe`. When it is set, the file must exist; there is no fallback.

```powershell
$env:AUTOLOOP_SHELL = "C:\Program Files\Git\bin\sh.exe"
```

### Check the shell

`autoloop doctor` shows the shell it found:

```text
  ✓ shell                C:\Program Files\Git\bin\sh.exe
```

When there is no shell, the `shell` line fails with a message that names Git
for Windows and `AUTOLOOP_SHELL`, and `autoloop run` exits with the same
message.

### Tool scripts for PowerShell and cmd agents

The generated tool scripts (the event tool and the pi adapter) keep their
`#!/bin/sh` form. On Windows each one also gets a `<name>.cmd` sibling, so
agents that run commands through PowerShell or cmd can call it. Agent prompts
show the tool path with forward slashes (`C:/.../autoloops`), which Git Bash,
cmd, and PowerShell all accept.

### Known limits

- A timeout on a gate command (acceptance, intent, post-fire verify, progress,
  notify) or on a synchronous command-backend run ends only the `sh.exe`
  launcher. A command that never ends can hang the harness.
- A backend timeout or interrupt ends native Windows programs in the backend
  tree (for example `node`, `claude`, `codex`). MSYS utilities that bash starts
  (for example `sleep`) are outside the Windows process tree, so the run waits
  until they end.
- There is no cooperative interrupt (`SIGUSR1`). `autoloop control interrupt`
  ends the backend process tree instead.
- A `control respond` with no matching question stays pending (on Linux and
  macOS it is marked `ignored`).
- Git Bash can change backslashes in arguments that it gives to native
  programs, for example `node -e "...\\..."` in a backend command.
- Kanban terminals need tmux, which is not available on native Windows.
- `node-pty` is an optional dependency, so `npm install` succeeds without a
  prebuilt binary for your Node version. Only kanban terminals need it.
