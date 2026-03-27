# Autoideas miniloop

A miniloops-native loop that surveys a repository and generates a skeptically filtered improvement report.

Shape:
- scanner
- analyst
- reviewer
- synthesizer

The scanner identifies areas worth analyzing. The analyst deep-dives each area and produces concrete suggestions. The reviewer tries to kill weak ideas. The synthesizer compiles only the survivors into `ideas-report.md`.

## Fail-closed contract

Autoideas should prefer false negatives over false positives.

- A healthy run may reject many areas.
- A healthy run may end with only a few strong ideas.
- `ideas-report.md` should contain reviewer-validated suggestions, not every plausible thought.
- Inspect `progress.md` if you want to see what was trimmed or rejected.

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
- `progress.md` — current area, status, completed areas, PASS/DROP reviewer notes
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
./bin/miniloops run presets/autoideas /path/to/target-repo
```

Or with the installed shim:

```bash
miniloops run /path/to/tonic-loops/presets/autoideas /path/to/target-repo
```

For a one-off Claude dogfood run without editing config:

```bash
./bin/miniloops -b claude presets/autoideas /path/to/target-repo
```

## What it produces

An `ideas-report.md` containing:
- Concrete suggestions organized by area
- Only ideas that survived skeptical review
- Enough context to understand why each surviving idea is worth doing