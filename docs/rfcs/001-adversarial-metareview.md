# RFC-001: Adversarial Metareview with Verdict System

**Author:** Mikey O'Brien (mobrienv)
**Date:** 2026-04-09
**Status:** Draft

## Problem

The metareviewer today is a passive hygiene tool. It runs periodically, can edit config files and add memory entries, but has no structured way to influence loop direction. It cannot:

- Stop a loop that nailed it on iter 1
- Redirect a loop that's solving the wrong problem
- Take over when the task is trivial or the loop is too confused to converge
- Express confidence in a structured, machine-readable way

The result: loops waste iterations. They over-polish working code, dig deeper into wrong approaches, and never get a "wait, stop" signal early enough to matter.

## Proposal

Run the metareviewer after iteration 1 (always), and give it four structured verdicts:

| Verdict | Meaning | Loop behavior |
|---------|---------|---------------|
| `CONTINUE` | Approach is sound, more iterations will help | Normal continuation |
| `REDIRECT` | Wrong approach — here's what to do instead | Replace/amend the task prompt, continue from iter 2 with new direction |
| `TAKEOVER` | Too broken or too trivial — metareviewer emits the solution | Metareviewer output becomes the final result, loop terminates |
| `EXIT` | Already done, stop iterating | Accept iter 1 output as final, loop terminates |

## Design

### Verdict schema

The metareviewer emits a structured JSON block (fenced in its output) instead of freeform text:

```json
{
  "verdict": "CONTINUE | REDIRECT | TAKEOVER | EXIT",
  "confidence": 0.0-1.0,
  "reasoning": "One paragraph explaining the decision",
  "redirect_prompt": "New/amended task prompt (REDIRECT only)",
  "takeover_output": "Direct solution content (TAKEOVER only)",
  "suggestions": ["Optional list of specific improvements for CONTINUE"]
}
```

### When it runs

| Iteration | Review? | Rationale |
|-----------|---------|-----------|
| 1 | Always | The adversarial gate — highest-value checkpoint |
| 2+ | Per existing `review.every_iterations` config | Normal periodic review |

This is a config change, not a behavioral one. The `shouldRunMetareview` function currently skips iter 1:

```typescript
// Current: iteration > 1 && (iteration - 1) % every === 0
// Proposed: iteration === 1 || (iteration > 1 && (iteration - 1) % every === 0)
```

### Prompt changes

The post-iter-1 metareview prompt gets an adversarial framing prepended to the existing template:

```
You are the adversarial gate for this loop. Your job is to be skeptical.
Assume the loop is wasting compute until proven otherwise.

After reviewing iteration 1 output, you MUST emit exactly one verdict:

- CONTINUE: The approach is correct AND more iterations will meaningfully improve output.
- REDIRECT: The approach is wrong or suboptimal. Provide a corrected task prompt.
- TAKEOVER: The task is trivial enough to solve now, or so broken that iterating won't help. Provide the solution directly.
- EXIT: Iteration 1 output is already sufficient. Stop.

Default to EXIT or REDIRECT. Only CONTINUE if you can articulate what specific improvements further iterations will produce.
```

For iter 2+ reviews, the existing prompt is preserved with the verdict schema appended. The adversarial framing is iter-1 only.

### Loop runner changes

In `iterateWith()` (harness/index.ts ~L468):

```
iter 1 → run iteration → metareview (adversarial) → parse verdict
  CONTINUE  → iter 2 (normal loop)
  REDIRECT  → patch task prompt in loop config → iter 2 with new direction
  TAKEOVER  → write metareviewer output as final result → emit task.complete
  EXIT      → accept iter 1 output as final → emit task.complete
```

Key implementation details:

1. **Verdict parsing**: Extract JSON block from metareview output. If no valid JSON found, default to `CONTINUE` (backward compatible — existing freeform reviews keep working).

2. **REDIRECT mechanics**: Write amended prompt to `state/redirect.md`, which the harness injects as a prepend to the next iteration's prompt: `"IMPORTANT: The metareviewer has redirected this task. Disregard your previous approach. New direction: {redirect_prompt}"`.

3. **TAKEOVER mechanics**: The metareviewer is already allowed to edit files in the state directory. For takeover, it writes its solution to the scratchpad/output files directly. The harness then emits `task.complete` on its behalf.

4. **EXIT mechanics**: Harness emits `task.complete` with the current scratchpad state. No further iterations.

### Config

```toml
[review]
enabled = true
every_iterations = 0          # existing: periodic review cadence
adversarial_first = true      # NEW: always run after iter 1 with adversarial prompt
                              # default true; set false to restore old behavior
```

### Event journal

New journal events for observability:

```
review.verdict  { verdict: "REDIRECT", confidence: 0.85, reasoning: "..." }
review.redirect { original_prompt: "...", new_prompt: "..." }
review.takeover { output_path: "state/takeover-output.md" }
review.exit     { iteration: 1, reason: "..." }
```

These are journal-only (not topology events), so they don't interfere with the existing event routing system.

## Migration

- `adversarial_first` defaults to `true` — all existing loops get the new behavior automatically
- Existing freeform metareview output (no JSON verdict) is treated as `CONTINUE` — fully backward compatible
- No changes to topology definitions, role prompts, or event routing
- The only file changes are in `metareview.ts`, `prompt.ts`, and `index.ts`

## Risks

| Risk | Mitigation |
|------|------------|
| Metareviewer is too aggressive, exits/redirects when it shouldn't | `confidence` field lets us add a threshold later; default-to-CONTINUE on parse failure |
| TAKEOVER produces lower quality than the loop would have | Track takeover frequency + quality in loop metrics; can disable per-preset |
| REDIRECT prompt is worse than the original | The redirect is a prepend, not a replacement — original context is preserved |
| Extra LLM call on every loop adds latency | One call after iter 1 is cheap vs. 3-4 wasted iterations; net iteration count should decrease |

## Success Metrics

- **Iteration efficiency**: avg iterations to completion should decrease 20-30%
- **EXIT rate**: % of loops that complete in 1 iteration (expect 10-15% for well-specified tasks)
- **REDIRECT accuracy**: % of redirects that lead to successful completion vs. loops that needed manual intervention
- **TAKEOVER quality**: compare takeover outputs to multi-iteration outputs on same task specs

## Open Questions

1. Should REDIRECT be allowed on iter 2+ reviews, or only iter 1?
2. Should there be a max confidence threshold below which TAKEOVER is blocked?
3. Should the adversarial prompt intensity be configurable (e.g., `review.adversarial_level = "high" | "medium" | "low"`)?
