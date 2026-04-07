# autoloop

Autonomous LLM loop harness for long-horizon, multi-role agent work.

[![npm version](https://img.shields.io/npm/v/@mobrienv/autoloop)](https://www.npmjs.com/package/@mobrienv/autoloop)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

## Features

- **Event-driven role routing** -- roles hand off via structured events; the harness manages iteration, backpressure, and completion detection
- **Append-only journal** -- every iteration is recorded; inspect, replay, or audit any run
- **Preset system** -- bundled presets for common workflows (code, docs, QA, security, specs); create your own in minutes
- **Persistent memory** -- loops accumulate learnings and preferences across runs
- **Dynamic chains** -- compose presets into multi-stage pipelines
- **Worktree isolation** -- run loops in git worktrees so your working tree stays clean

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [Usage](#usage)
- [Bundled presets](#bundled-presets)
- [Creating custom presets](#creating-custom-presets)
- [Project structure](#project-structure)
- [Developer scripts](#developer-scripts)
- [Running tests](#running-tests)
- [Further reading](#further-reading)
- [Contributing](#contributing)

## Install

### From npm (recommended)

```bash
npm install -g @mobrienv/autoloop
autoloop --help
```

### From source

```bash
git clone https://github.com/mikeyobrien/autoloop.git && cd autoloop
npm install
npm run build
node bin/autoloop --help
```

## Quick start

```bash
# Run a bundled preset
autoloop run autocode "Fix the login bug"
```

`autocode` is a bundled preset. The quoted string is the prompt passed to the loop. The harness iterates through roles (planner -> builder -> critic -> finalizer) until a `task.complete` event is emitted or the iteration limit is reached.

## Usage

```
autoloop run <preset-name|preset-dir> [prompt...] [flags]
autoloop emit <topic> [summary]
autoloop inspect <artifact> [selector] [project-dir] [--format <md|terminal|text|json|csv>]
autoloop memory <list|add|remove> [args]
autoloop task <add|complete|update|remove|list> [args]
autoloop list
autoloop loops [--all]
autoloop loops show <run-id>
autoloop loops artifacts <run-id>
autoloop loops watch <run-id>
autoloop loops health [--verbose]
autoloop chain <list|run> [args]
autoloop runs clean [--max-age <days>]
autoloop worktree <list|show|merge|clean> [args]
autoloop config <show|set|unset|path> [args]
autoloop dashboard [--port <port>]
```

### Flags

| Flag | Description |
|------|-------------|
| `-h`, `--help` | Show usage |
| `-v`, `--verbose` | Debug-level logging |
| `-b`, `--backend` | Override backend command (e.g. `-b claude`) |
| `-p`, `--preset` | Resolve a named or custom preset |
| `--chain` | Run an inline chain of comma-separated presets |
| `--profile <spec>` | Activate a profile (`repo:<name>` or `user:<name>`), repeatable |
| `--no-default-profiles` | Suppress config-defined default profiles |

### Examples

```bash
# Run a preset by name
autoloop run autocode "Refactor the auth module"

# Run from a custom preset directory
autoloop run ./my-preset "Analyze the API"

# Override the backend
autoloop run autoqa -b claude "Review recent changes"

# List available presets
autoloop list

# Run an inline chain
autoloop run --chain autospec,autocode "Design and build feature X"
```

## Bundled presets

| Preset | Purpose |
|--------|---------|
| `autocode` | Plan, build, review, and commit code changes |
| `autodoc` | Audit, write, verify, and publish documentation |
| `autofix` | Diagnose, fix, and verify bugs |
| `autoideas` | Scan, analyze, review, and synthesize improvement ideas |
| `automerge` | Merge a completed worktree branch back into its base branch |
| `autoperf` | Profile, measure, optimize, and judge performance |
| `autopr` | Turn the current branch into a reviewable pull request |
| `autoqa` | Plan, execute, inspect, and report on QA |
| `autoresearch` | Research strategies, implement, evaluate, and benchmark |
| `autoreview` | Read, suggest, check, and summarize code reviews |
| `autosec` | Scan, analyze, harden, and report on security |
| `autosimplify` | Scope, simplify, verify, and review code for simplicity |
| `autospec` | Research, clarify, design, plan, and critique specifications |
| `autotest` | Survey, write, run, and assess tests |

## Creating custom presets

A preset is a directory containing `autoloops.toml`, `topology.toml`, `harness.md`, and a `roles/` folder. See [Creating presets](docs/creating-presets.md) for the full guide, or examine any `presets/<name>/` directory as a working example.

## Project structure

```
autoloop/
├── bin/autoloop        # CLI entry point (Node.js ESM)
├── src/                # TypeScript source
│   ├── main.ts         # CLI dispatch
│   ├── harness/        # Loop engine (iteration, events, routing)
│   ├── config.ts       # TOML config loading
│   ├── chains.ts       # Chain orchestration
│   ├── memory.ts       # Persistent loop memory
│   └── usage.ts        # Help text
├── presets/            # Bundled preset definitions
│   └── <name>/
│       ├── autoloops.toml
│       ├── topology.toml
│       ├── harness.md
│       └── roles/
├── docs/               # Reference documentation
├── dist/               # Compiled output (generated)
└── package.json
```

## Developer scripts

A convenience dispatcher lives at `bin/dev`:

```bash
bin/dev build          # compile TypeScript
bin/dev test           # run the test suite
bin/dev test:watch     # vitest in watch mode
bin/dev hooks          # install git hooks
bin/dev run [args]     # run autoloop
bin/dev --help         # list all subcommands
```

## Running tests

```bash
npm test
```

Runs the test suite via [Vitest](https://vitest.dev/).

### Mock backend

A deterministic mock backend (`src/testing/mock-backend.ts`) removes the need for a live LLM during testing. Point it at a JSON fixture to control output, exit code, and emitted events:

```bash
export MOCK_FIXTURE_PATH=test/fixtures/backend/complete-success.json
node bin/autoloop run . -b "node dist/testing/mock-backend.js"
```

See [CLI reference](docs/cli.md#mock-backend) for fixture schema and bundled scenarios.

## Further reading

- [Platform architecture](docs/platform.md)
- [Configuration reference](docs/configuration.md)
- [Creating presets](docs/creating-presets.md)
- [Topology and event routing](docs/topology.md)
- [Memory system](docs/memory.md)
- [Dynamic chains](docs/dynamic-chains.md)
- [CLI reference](docs/cli.md)
- [Dashboard](docs/dashboard.md)
- [Profiles](docs/profiles.md)
- [Tasks](docs/tasks.md)
- [Worktree isolation](docs/worktree.md)
- [Releasing](docs/releasing.md)

## Contributing

Bug reports and pull requests are welcome at [github.com/mikeyobrien/autoloop](https://github.com/mikeyobrien/autoloop/issues).

Prerequisites for development: Node.js >= 18, npm. Run `npm install && npm run build` to get started, then `npm test` to verify.
