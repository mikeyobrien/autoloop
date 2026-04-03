# Autocode miniloop

A autoloops-native port of Ralph's code-assist/autocode loop.

Shape:
- planner
- builder
- critic
- finalizer

Shared state lives in project files plus the autoloops journal. One active step is tracked in `.autoloop/progress.md`.

## Fail-closed contract

Autocode is not an approval machine.

- Planner decomposes work into the next smallest slice.
- Builder implements and proves the slice.
- Critic tries to break the slice, including independently running a manual smoke test that exercises the builder's changed code path whenever a practical manual surface is available, and rejects on missing evidence.
- Finalizer tries to prove the whole task is still incomplete before allowing completion.

Success is evidence-based, not prose-based. Only the finalizer may emit `task.complete`.

## Files

- `autoloops.toml` — loop + backend config
- `topology.toml` — role deck + handoff graph
- `harness.md` — shared harness rules loaded every iteration
- `roles/planner.md`
- `roles/build.md`
- `roles/critic.md`
- `roles/finalizer.md`

## Shared working files created by the loop

The planner is expected to create and maintain:
- `.autoloop/context.md`
- `.autoloop/plan.md`
- `.autoloop/progress.md`
- `.autoloop/logs/`

## Backend

This preset assumes the built-in Pi adapter:

```toml
backend.kind = "pi"
backend.command = "pi"
```

Pi is the only supported real adapter path here.

For deterministic local harness debugging only, switch to the repo mock backend:

```toml
backend.kind = "command"
backend.command = "../../examples/mock-backend.sh"
```

## Run

From this repo root:

```bash
./bin/autoloops run autocode "Add a --verbose flag to the CLI"
```

Or with the installed shim:

```bash
autoloops run autocode "Add a --verbose flag to the CLI"
```

For a one-off Claude dogfood run without editing config:

```bash
./bin/autoloops -b claude -p autocode "Add a --verbose flag to the CLI"
```

## Intended input styles

The planner prompt supports the same three broad entry modes as Ralph's code-assist preset:
- a rough implementation request
- a single `.code-task.md` file path
- an existing implementation/spec directory

The planner must normalize that into the shared working files and then hand off one concrete next slice.