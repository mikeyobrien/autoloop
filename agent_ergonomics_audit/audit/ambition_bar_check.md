# Ambition bar — pass 1 (full mode)

- Substantive landed changes: 13 (target ≥10) ✓
  1. Global stderr+exit-code error contract (fail.ts + 7 command files)
  2. --version/-V/version
  3. Unknown-command typo guard (never preset-fallthrough on near-miss)
  4. help word alias + help <cmd> re-dispatch
  5. capabilities (machine-readable contract)
  6. robot-docs (in-tool agent handbook)
  7. triage mega-command (+--json)
  8. Subverb did-you-mean: memory/task/worktree/config/loops flags
  9. Bare invocation → usage
  10. Exit-code dictionary documented (--help + capabilities)
  11. config unset implemented (help-drift bug)
  12. run --help guard (no accidental loop start)
  13. dashboard watchRegistry test deflake (fsevents race)
- Dimensions touched: 7 of 11 ✓ (parseability, composability, intuitiveness,
  intent_inference, self_documentation, error_pedagogy, ergonomics)
- Required types: mega-command ✓ · capabilities/robot-docs ✓ · --json read-side ✓
  (triage --json; list/loops/doctor/stats pre-existing) · error rewrite ✓ ·
  intent-inference handler ✓
- Regression tests: 23 new + 3 updated, all green; full check gate green.
- Self-prompt round: not required (bar exceeded on first apply round).

Bar met: YES
