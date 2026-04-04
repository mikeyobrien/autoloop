# Autoresearch miniloop

An autoloop-native autonomous experiment loop inspired by Ralph's autoresearch preset.

Shape:
- strategist — decides what experiment to try next
- implementer — executes the planned change
- benchmarker — runs measurements and captures metrics
- evaluator — skeptically judges keep/discard, optionally using LLM-as-judge

State lives in `.autoloop/autoresearch.md`, `.autoloop/experiments.jsonl`, and `.autoloop/progress.md`.

## Fail-closed contract

Autoresearch is a skeptical experiment loop, not an auto-approval loop.

- Every experiment needs an explicit benchmark command and success threshold.
- Missing or noisy evidence should reroute to rerun, block, or discard.
- The LLM judge can help on semantics, but it cannot rescue weak metrics.
- The strategist, not the evaluator, decides when the overall search is done.

## Files

- `autoloops.toml` — loop + backend config
- `topology.toml` — role deck + handoff graph
- `harness.md` — shared harness rules loaded every iteration
- `roles/strategist.md`
- `roles/implementer.md`
- `roles/benchmarker.md`
- `roles/evaluator.md`

## LLM-as-judge

The evaluator can invoke `scripts/llm-judge.sh` for semantic evaluation when hard metrics are insufficient:

```bash
echo "the code output" | ../../scripts/llm-judge.sh "output is valid JSON with a 'status' field"
```

Returns `{"pass": true|false, "reason": "..."}` and exits 0 (pass) or 1 (fail).

## Run

From the repo root:

```bash
autoloop run presets/autoresearch "Optimize test suite runtime by 30%"
```

## Example use cases

- **Performance optimization**: "Reduce API response latency by 20%"
- **Test coverage**: "Increase branch coverage to 90% in src/harness.tn"
- **Code quality**: "Reduce cyclomatic complexity of the dispatch function"
- **Search/tuning**: "Find the optimal batch size for the data pipeline"

## Experiment cycle

1. **Strategist** reads history, forms a hypothesis, writes a plan with explicit success and falsification conditions
2. **Implementer** makes the minimal code change to test the hypothesis
3. **Benchmarker** runs the measurement command, captures metrics, and records evidence
4. **Evaluator** compares metrics, optionally runs LLM judge, and keeps or discards
5. Loop back to strategist for the next experiment or an evidence-backed stop