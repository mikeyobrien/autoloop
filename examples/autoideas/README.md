# Autoideas miniloop

A miniloops-native loop that surveys a repository and generates an actionable improvement report.

Shape:
- scanner
- analyst
- reviewer
- synthesizer

The scanner identifies areas worth analyzing. The analyst deep-dives each area and produces concrete suggestions. The reviewer validates suggestion quality. The synthesizer compiles everything into `ideas-report.md`.

## Files

- `miniloops.toml` — loop + backend config
- `topology.toml` — role deck + handoff graph
- `harness.md` — shared harness rules loaded every iteration
- `roles/scanner.md`
- `roles/analyst.md`
- `roles/reviewer.md`
- `roles/synthesizer.md`

## Shared working files created by the loop

- `scan-areas.md` — prioritized list of repo areas to analyze
- `progress.md` — current area, status, completed areas
- `ideas-report.md` — the final output report

## Backend

This preset assumes the built-in Pi adapter:

```toml
backend.kind = "pi"
backend.command = "pi"
```

For deterministic local harness debugging only, switch to the repo mock backend:

```toml
backend.kind = "command"
backend.command = "../../examples/mock-backend.sh"
```

## Run

From the repo root:

```bash
./bin/miniloops run examples/autoideas /path/to/target-repo
```

Or with the installed shim:

```bash
miniloops run /path/to/tonic-loops/examples/autoideas /path/to/target-repo
```

For a one-off Claude dogfood run without editing config:

```bash
./bin/miniloops -b claude examples/autoideas /path/to/target-repo
```

## What it produces

An `ideas-report.md` containing:
- Concrete, validated suggestions organized by area
- Impact/effort ratings for each suggestion
- A priority matrix ranking suggestions by impact/effort ratio
