This is a autoloops-native autoresearch loop inspired by Ralph's autoresearch preset.

The loop runs autonomous experiments: strategize, implement, measure, evaluate.

Global rules:
- Shared working files are the source of truth: `.autoloop/autoresearch.md`, `.autoloop/experiments.jsonl`, and `.autoloop/progress.md`.
- One experiment at a time. Do not start a new experiment before the current one is evaluated.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read the shared working files and the relevant source before acting.
- Prefer small, reversible changes that can be cleanly reverted if the experiment fails.
- Missing baseline, missing raw measurement, missing correctness evidence, or ambiguous metrics should block or discard the experiment, not quietly pass.
- The evaluator makes keep/discard decisions. Other roles do not commit or revert.
- False keeps are worse than false discards.
- Qualitative wins only count when the rubric was written down before the experiment.
- Use `./.autoloop/autoloops memory add learning ...` for durable learnings.
- Do not invent extra phases. Stay inside strategist -> implementer -> benchmarker -> evaluator.

State files:
- `.autoloop/autoresearch.md` — running session document: goal, constraints, experiment history summary, current hypothesis.
- `.autoloop/experiments.jsonl` — append-only log. Each line: `{"id":N, "hypothesis":"...", "change":"...", "metric_before":..., "metric_after":..., "verdict":"keep|discard", "reason":"..."}`.
- `.autoloop/progress.md` — current experiment status, what the next role should do.

LLM-as-judge:
- The evaluator can invoke `../../scripts/llm-judge.sh` to get a semantic pass/fail verdict.
- Usage: `echo "<content>" | ../../scripts/llm-judge.sh "<criteria>"`
- The judge returns JSON with `{"pass": true|false, "reason": "..."}` and exits 0 (pass) or 1 (fail).
- Use the judge when hard metrics alone are insufficient (e.g., code quality, semantic correctness).
- The judge does not override weak or missing hard evidence.