# Post-pass-1 intent corpus re-run (vs pre-pass baseline)

| corpus_id | invocation | pre outcome | post outcome |
|---|---|---|---|
| I-001 | autoloop --version | useless_error (preset error, stdout, exit 0) | works: prints version, exit 0 |
| I-002 | autoloop help | useless_error | works: prints usage |
| I-003 | autoloop staus | useless_error | useful_hint: "Did you mean `autoloop stats`?" stderr, exit 1 |
| I-004 | autoloop loops --jsno | useless_error (exit 0) | useful_hint: "Did you mean `--json`?" stderr, exit 1 |
| I-005 | autoloop capabilities | useless_error | works: JSON contract |
| I-006 | autoloop memory lst | useless_error (usage dump exit 0) | useful_hint: "Did you mean `list`?" exit 1 |
| I-007 | autoloop task ad hello | useless_error | useful_hint: "Did you mean `add`?" exit 1 |
| I-008 | autoloop inspect scratchpd | useful_hint (but exit 0, stdout) | useful_hint (stderr, exit 1) |
| I-009 | autoloop run autocod | useful_hint (but exit 0, stdout) | useful_hint (stderr, exit 1) |
| I-010 | autoloop (bare) | useless_error | works: full usage |

Pre: 2/10 useful, 0 correct exit codes. Post: 10/10 useful or working, all exit codes correct.
