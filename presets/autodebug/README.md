# Autodebug

Systematic debugging loop based on the [superpowers systematic-debugging skill](https://github.com/obra/superpowers/tree/main/skills/systematic-debugging).

Core philosophy: **NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.**

## Roles

- **investigator** — Phase 1 (Root Cause Investigation) + Phase 2 (Pattern Analysis): gathers evidence, traces data flow backward, compares working vs broken code
- **strategist** — Phase 3 (Hypothesis & Testing): forms single testable hypothesis, designs minimal test and fix approach with defense-in-depth layers
- **fixer** — Phase 4 (Implementation): creates failing test FIRST, implements single fix at root cause, adds defense-in-depth validation
- **verifier** — Quality gate: independently verifies root cause understanding, rejects symptom fixes, handles 3+ failure escalations, emits task.complete

## Event Flow

```
loop.start → investigator → rootcause.ready → strategist → hypothesis.ready → fixer → fix.ready → verifier
  ↓ (rejection at any stage routes back to investigator with new evidence)
  → fix.verified → task.complete
  → fix.escalate → verifier (architecture assessment)
```

## Key Techniques

- **Root cause tracing**: trace backward through call stack to original trigger
- **Defense-in-depth**: validate at 4 layers (entry, business logic, environment, debug)
- **Condition-based waiting**: replace timeouts with condition polling
- **Test pollution bisection**: find-polluter pattern for test state leaks
- **3-strike escalation**: 3+ failed fixes triggers architecture review

## Red Flags (auto-reject)

- Proposing fixes before investigation
- Fixing at symptom point instead of root cause
- No failing test before fix
- "Quick fix for now"
- 3+ fix attempts without questioning architecture

## Run

```bash
autoloop run autodebug "describe the bug, error message, or test failure here"
```

## Output

- `investigation.md` — evidence, reproduction, data flow trace, root cause
- `hypothesis.md` — testable hypothesis with fix approach
- `fix-log.md` — ordered log of all fix attempts
- `progress.md` — current phase and decisions
