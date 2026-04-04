# autoloop

Autonomous LLM loop harness and control plane for long-horizon autonomous work. Runs multi-role, event-driven loops where each iteration is handled by a specialized role (planner, builder, critic, etc.) that hands off to the next via structured events. The harness manages iteration limits, event routing, memory, and completion detection so you can focus on the prompt and preset design.

External interfaces — CLI, chat, cron, future API — are thin shells that launch, observe, and report on runs. Presets are the product surface; the append-only journal is the source of truth. See [Platform Architecture](docs/platform.md) for the full model.

## Prerequisites

- **Node.js** >= 18 (ES2022 target)
- **npm**
- An LLM backend on your `$PATH` — defaults to `pi`, but any CLI that accepts a prompt argument works (e.g. `claude`)

## Quick start

```bash
# Clone and build
git clone <repo-url> && cd autoloop
npm install
npm run build

# Run your first autoloop
node bin/autoloop run autocode "Fix the login bug"
```

`autocode` is a bundled preset. The quoted string is the prompt passed to the loop. The harness iterates through roles (planner -> builder -> critic -> finalizer) until a `task.complete` event is emitted or the iteration limit is reached.

## Usage

```
autoloop run <preset> [prompt...] [flags]
autoloop list
autoloop emit <topic> [summary]
autoloop inspect <artifact> [selector] [--format <md|terminal|json|csv>]
autoloop memory <list|status|find|add|remove> [args]
autoloop chain <list|run> [args]
```

### Flags

| Flag | Description |
|------|-------------|
| `-h`, `--help` | Show usage |
| `-v`, `--verbose` | Debug-level logging |
| `-b`, `--backend` | Override backend command (e.g. `-b claude`) |
| `-p`, `--preset` | Resolve a named or custom preset |
| `--chain` | Run an inline chain of comma-separated presets |

### Examples

```bash
# Run a preset by name
node bin/autoloop run autocode "Refactor the auth module"

# Run from a custom preset directory
node bin/autoloop run ./my-preset "Analyze the API"

# Override the backend
node bin/autoloop run autoqa -b claude "Review recent changes"

# List available presets
node bin/autoloop list

# Run an inline chain
node bin/autoloop run --chain autospec,autocode "Design and build feature X"
```

## Bundled presets

| Preset | Purpose |
|--------|---------|
| `autocode` | Plan, build, review, and commit code changes |
| `autodoc` | Audit, write, verify, and publish documentation |
| `autofix` | Diagnose, fix, and verify bugs |
| `autoideas` | Scan, analyze, review, and synthesize improvement ideas |
| `autoperf` | Profile, measure, optimize, and judge performance |
| `autoqa` | Plan, execute, inspect, and report on QA |
| `autoresearch` | Research strategies, implement, evaluate, and benchmark |
| `autoreview` | Read, suggest, check, and summarize code reviews |
| `autosec` | Scan, analyze, harden, and report on security |
| `autosimplify` | Scope, simplify, verify, and review code for simplicity |
| `autospec` | Research, clarify, design, plan, and critique specifications |
| `autotest` | Survey, write, run, and assess tests |

## Project structure

```
autoloop/
├── bin/autoloop       # CLI entry point (Node.js ESM)
├── src/                   # TypeScript source
│   ├── main.ts            # CLI dispatch
│   ├── harness/           # Loop engine (iteration, events, routing)
│   ├── config.ts          # TOML config loading
│   ├── chains.ts          # Chain orchestration
│   ├── memory.ts          # Persistent loop memory
│   └── usage.ts           # Help text
├── presets/               # Bundled preset definitions
│   └── <name>/
│       ├── autoloops.toml # Loop config
│       ├── topology.toml  # Role deck and handoff graph
│       ├── harness.md     # Shared instructions
│       └── roles/         # Per-role prompt files
├── docs/                  # Reference documentation
├── dist/                  # Compiled output (generated)
└── package.json
```

## Creating custom presets

A preset is a directory containing `autoloops.toml`, `topology.toml`, `harness.md`, and a `roles/` folder. See [docs/creating-presets.md](docs/creating-presets.md) for the full guide, or examine any `presets/<name>/` directory as a working example.

## Running tests

```bash
npm test
```

Runs the test suite via [Vitest](https://vitest.dev/).

### Mock backend

A deterministic mock backend (`src/testing/mock-backend.ts`) removes the need for a live LLM backend during testing. Point it at a JSON fixture to control the output, exit code, and emitted events:

```bash
export MOCK_FIXTURE_PATH=test/fixtures/backend/complete-success.json
node bin/autoloop run . -b "node dist/testing/mock-backend.js"
```

See [docs/cli.md](docs/cli.md#mock-backend) for fixture schema and bundled scenarios.

## Further reading

- [Platform architecture](docs/platform.md)
- [Configuration reference](docs/configuration.md)
- [Creating presets](docs/creating-presets.md)
- [Topology and event routing](docs/topology.md)
- [Memory system](docs/memory.md)
- [Dynamic chains](docs/dynamic-chains.md)
- [CLI reference](docs/cli.md)
