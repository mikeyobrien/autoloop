# AutoPerf miniloop

A miniloops-native performance profiling and optimization loop.

AutoPerf identifies hot paths, establishes baselines, implements targeted optimizations, measures results, and keeps or discards changes — similar to autoresearch but scoped specifically to performance.

Shape:
- profiler — identifies hot paths, establishes baselines
- optimizer — implements targeted optimization
- measurer — runs benchmarks, captures before/after metrics
- judge — skeptically evaluates improvement, keeps or discards

## Fail-closed contract

AutoPerf should distrust claimed wins.

- No benchmark parity means no real comparison.
- No correctness proof means no kept optimization.
- Noisy or weakly evidenced gains should be rerun or discarded.
- Completion means either the target was met with logged wins or the remaining candidate space was explicitly exhausted.

## How it works

1. **Profiler** identifies available benchmarking tools, establishes baseline measurements, and ranks hot paths by estimated impact.
2. **Optimizer** implements a single, focused optimization for the highest-impact target.
3. **Measurer** runs the same benchmarks as the baseline, captures the delta, and verifies tests still pass.
4. **Judge** decides keep or discard based on meaningful improvement and correctness. Tracks cumulative progress.

## AutoPerf vs AutoResearch

- **AutoPerf** = scoped to performance. Profiles, optimizes, measures. The metric is always a performance number.
- **AutoResearch** = general experiment loop. Any hypothesis, any metric, any domain.

## Files

- `miniloops.toml` — loop + backend config
- `topology.toml` — role deck + handoff graph
- `harness.md` — shared harness rules loaded every iteration
- `roles/profiler.md`
- `roles/optimizer.md`
- `roles/measurer.md`
- `roles/judge.md`

## Shared working files created by the loop

- `.miniloop/perf-profile.md` — goal, baselines, identified hot paths
- `.miniloop/perf-log.jsonl` — append-only log of optimization attempts and verdicts
- `.miniloop/progress.md` — current optimization tracking

## Run

From the repo root:

```bash
./bin/miniloops run presets/autoperf "Reduce API response latency by 30%"
```

Or with the installed shim:

```bash
miniloops run /path/to/tonic-loops/presets/autoperf /path/to/target-repo
```
