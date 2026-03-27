This is a miniloops-native autoperf loop for performance profiling and optimization.

The loop identifies hot paths, establishes baselines, implements targeted optimizations, measures results, and keeps or discards changes — iterating until performance goals are met.

Global rules:
- Shared working files are the source of truth: `perf-profile.md`, `perf-log.jsonl`, `progress.md`.
- One optimization at a time. Do not start the next before the current one is measured and judged.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Prefer small, reversible changes that can be cleanly reverted if the optimization fails.
- Measure before and after. No optimization is accepted without measurement.
- False keeps are worse than false discards.
- Missing baseline, missing tests, changed benchmark procedure, or noisy/inconclusive results should route to retry or discard, not acceptance.
- The judge makes keep/discard decisions. Other roles do not commit or revert.
- Use `./.miniloops/miniloops memory add learning ...` for durable learnings.
- Do not invent extra phases. Stay inside profiler → optimizer → measurer → judge.

State files:
- `perf-profile.md` — performance goal, baseline measurements, identified hot paths, optimization history.
- `perf-log.jsonl` — append-only log. Each line: `{"id":N, "target":"...", "change":"...", "metric_before":..., "metric_after":..., "verdict":"keep|discard", "reason":"..."}`.
- `progress.md` — current optimization target, what the next role should do.