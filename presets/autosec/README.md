# AutoSec miniloop

A autoloops-native security audit and hardening loop.

AutoSec scans a target repo for security vulnerabilities across injection, auth, secrets, dependencies, and configuration. Candidate findings are confirmed or dismissed by an analyst, fixed by a hardener when appropriate, and tracked in a prioritized security report.

Shape:
- scanner — generates candidate findings across OWASP-style categories
- analyst — skeptically confirms or dismisses findings with evidence
- hardener — implements fixes and proves the vulnerable path is closed
- reporter — compiles prioritized security report and keeps weakly verified items open

## Fail-closed contract

AutoSec should prefer open risks over fake certainty.

- Zero confirmed findings is a valid result.
- A candidate is not a vuln until exploitability is shown.
- A fix is not fixed until the vulnerable path is proven closed.
- Missing evidence should end up as dismissal or open risk, not inflated confidence.

## How it works

1. **Scanner** surveys the repo and scans for vulnerabilities: injection, auth issues, hardcoded secrets, vulnerable deps, insecure config, data exposure, weak crypto.
2. **Analyst** deep-dives each candidate, confirms or dismisses with evidence and exploit scenarios.
3. **Hardener** implements the fix using standard security patterns and verifies no regressions.
4. **Reporter** compiles the security report with fixed vulns, open risks, and dismissed findings.

## Files

- `autoloops.toml` — loop + backend config
- `topology.toml` — role deck + handoff graph
- `harness.md` — shared harness rules loaded every iteration
- `roles/scanner.md`
- `roles/analyst.md`
- `roles/hardener.md`
- `roles/reporter.md`

## Shared working files created by the loop

- `.autoloop/sec-findings.md` — raw candidate findings with location, type, severity, evidence
- `.autoloop/sec-report.md` — compiled security report with fixes and open risks
- `.autoloop/progress.md` — current finding tracking

## Run

From the repo root:

```bash
./bin/autoloops run presets/autosec /path/to/target-repo
```

Or with the installed shim:

```bash
autoloops run /path/to/tonic-loops/presets/autosec /path/to/target-repo
```
