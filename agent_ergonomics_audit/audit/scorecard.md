# autoloop agent-ergonomics scorecard — pass 1 (2026-06-11)

Scores 0–1000. Evidence in agent_surfaces.jsonl (pre) and the probe transcripts.

| surface | dimension | pre | post | evidence (post) |
|---|---|---|---|---|
| error contract (global) | output_parseability | 150 | 900 | all error paths via cli/fail.ts → stderr + exit code; pinned by 23 tests |
| error contract (global) | composability | 200 | 900 | `--json \| jq` clean; exit-code dictionary documented |
| --version | agent_intuitiveness | 0 | 950 | `--version`/`-V`/`version` print semver |
| unknown command fallthrough | intent_inference | 300 | 900 | commandTypo guard in main.ts; `staus`→`stats`, never preset-run |
| capabilities | self_documentation | 0 | 900 | `capabilities` JSON: commands, exit codes, env, output contract |
| robot-docs | self_documentation | 0 | 850 | in-tool agent handbook |
| triage (new) | agent_ergonomics | n/a | 900 | one call = loops+health+doctor+stats+next commands |
| loops flag typo | intent_inference | 250 | 900 | `--jsno`→"Did you mean `--json`?" stderr exit 1 |
| memory/task subverbs | intent_inference | 300 | 900 | did-you-mean on all subverb typos |
| inspect | composability | 400 | 850 | errors stderr + exit 1 (suggestions pre-existing) |
| config | self_documentation | 500 | 850 | `unset` implemented (was advertised but missing) |
| bare invocation | agent_intuitiveness | 350 | 850 | prints full usage |
| run --help guard | safety_with_recovery | 300 | 850 | `run <preset> --help` shows help, never starts a loop |

Median uplift across touched surfaces: ≈ +550. No surface regressed.
