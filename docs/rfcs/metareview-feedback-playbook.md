# RFC: Metareview Effectiveness Feedback & Playbook

**Author:** mobrienv
**Date:** 2026-04-11
**Status:** Draft
**Slug:** `metareview-feedback-playbook`

## Problem

The metareviewer emits verdicts (CONTINUE/REDIRECT/TAKEOVER/EXIT) but never learns whether they helped. `runMetareviewReview()` writes a `review.verdict` journal event and returns — nothing evaluates whether the verdict improved subsequent iterations. The metareviewer flies blind.

Meanwhile, project memory contains operational patterns (e.g., "check allowed-events before emitting", "one wrong emit costs 2-3 iterations") that the metareviewer reads as flat text but cannot systematically match to loop state or apply as structured actions.

Meta's HyperAgents research (DGM-H) identifies this exact gap: self-modification without evaluation feedback yields 0.0 cross-domain transfer, while adding evaluation + metacognitive self-modification achieves imp@50=0.630.

## Proposal

Two changes, implemented sequentially:

1. **Review Effectiveness Feedback** — compute metrics between consecutive `review.verdict` events and inject them into the next metareview prompt.
2. **Condition→Action Playbook** — a structured `metareview-playbook.md` at the project level that the metareviewer reads, matches against loop state, applies, and rewrites.

## Design

### Part 1: Effectiveness Feedback

#### New function: `computeReviewEffectiveness(runLines: string[]): EffectivenessReport`

Location: `src/harness/effectiveness.ts` (new file)

Scans `runLines` for `review.verdict` events. For each pair of consecutive verdicts, computes metrics for the interval between them. Returns the report for the most recent interval plus a trend comparison to the interval before that.

```typescript
interface EffectivenessReport {
  previousVerdict: string;       // e.g. "CONTINUE"
  previousConfidence: number;    // e.g. 0.7
  iterationsSinceReview: number; // iterations in this interval
  validEmits: number;            // non-system events emitted
  totalIterations: number;       // total iterations in interval
  invalidEmits: number;          // event.invalid count in interval
  trend: "improving" | "declining" | "stable" | "insufficient-data";
}
```

Algorithm:
1. Walk `runLines`, collect indices of all `review.verdict` events
2. If < 1 verdict found, return `null` (no prior review to evaluate)
3. For the interval after the last verdict: count `iteration.start` events (= totalIterations), non-system events (= validEmits), `event.invalid` events (= invalidEmits)
4. If ≥ 2 verdicts, compute the same for the previous interval and derive trend by comparing valid-emit rates
5. O(n) single pass — reuses `extractTopic` and `isSystemEvent` from existing code

#### New function: `reviewEffectivenessText(report: EffectivenessReport | null): string`

Location: same file.

Renders the prompt section. Returns empty string if report is null.

```
## Review effectiveness (since last metareview)
- Previous verdict: CONTINUE (confidence: 0.7)
- Iterations since: 4
- Valid events emitted: 3/4 (75%)
- Invalid emits: 1
- Trend: declining (was 3/3 two reviews ago)
```

#### Injection point in `renderReviewPromptText`

Insert after `contextPressureText(...)`, before `backpressureText(...)`:

```typescript
// existing
contextPressureText(memoryStats, tasksStats, invalidCount, lastRejected) +
// NEW
reviewEffectivenessText(computeReviewEffectiveness(runLines)) +
// existing
backpressureText(backpressure) +
```

#### Journal event: `review.effectiveness`

Emit in `runMetareviewReview()` before `review.start`, so the effectiveness data is recorded alongside the review:

```typescript
const effectiveness = computeReviewEffectiveness(runLines);
if (effectiveness) {
  appendEvent(loop.paths.journalFile, loop.runtime.runId, String(iteration),
    "review.effectiveness",
    jsonField("previous_verdict", effectiveness.previousVerdict) + ", " +
    jsonField("valid_emits", `${effectiveness.validEmits}/${effectiveness.totalIterations}`) + ", " +
    jsonField("invalid_emits", String(effectiveness.invalidEmits)) + ", " +
    jsonField("trend", effectiveness.trend)
  );
}
```

### Part 2: Condition→Action Playbook

#### File: `metareview-playbook.md`

Lives at `{projectDir}/metareview-playbook.md`. Structured markdown with rule blocks:

```markdown
# Metareview Playbook

### R1: Invalid emit recovery
- **When:** invalidCount > 0
- **Action:** Write a role fragment reminding the agent of allowed events.
- **Effectiveness:** 0.85 (17/20)
- **Source:** Learned from autocode

### R2: Routing stall detection
- **When:** sameRoleCount >= 3
- **Action:** REDIRECT verdict with diagnosis of why the role is stuck.
- **Effectiveness:** 0.60 (6/10)
- **Source:** Learned from autocode run clear-loop
```

#### Parsing: `parsePlaybook(content: string): PlaybookRule[]`

Location: `src/harness/playbook.ts` (new file)

```typescript
interface PlaybookRule {
  id: string;           // "R1", "R2", etc.
  name: string;         // "Invalid emit recovery"
  when: string;         // raw condition string: "invalidCount > 0"
  action: string;       // action description
  effectiveness: string; // raw string: "0.85 (17/20)"
  source: string;       // provenance
}
```

Parser:
1. Split on `### R` headings
2. For each block, extract `- **When:**`, `- **Action:**`, `- **Effectiveness:**`, `- **Source:**` lines
3. Reject blocks missing `When` or `Action` — log warning, skip
4. Return array of valid rules

#### Condition matching: `evaluatePlaybookConditions(rules: PlaybookRule[], context: PlaybookContext): PlaybookRule[]`

```typescript
interface PlaybookContext {
  invalidCount: number;
  lastRejected: string;
  recentEvent: string;
  sameRoleCount: number;      // NEW: consecutive iterations with same suggested role
  memoryUsagePercent: number;  // derived from memoryStats
  openTasks: number;
  iteration: number;
}
```

Condition evaluation is **string-based comparison**, not `eval()`:
- Parse `when` string into `{field} {op} {value}` triples
- Supported ops: `>`, `>=`, `<`, `<=`, `==`, `!=`
- Supported fields: keys of `PlaybookContext`
- Compound conditions: `AND` joins (split on ` AND `)
- Unknown fields or malformed conditions → skip rule, log warning

#### New derived field: `sameRoleCount`

Add to `deriveRunContext` or compute in a helper. Walk `runLines` backwards from the end, count consecutive `iteration.start` events with the same `suggested_roles` value.

#### Prompt injection: `renderMatchedPlaybookRules(rules: PlaybookRule[]): string`

Returns empty string if no rules match. Otherwise:

```
## Active playbook rules

**R1: Invalid emit recovery** (effectiveness: 0.85)
- When: invalidCount > 0
- Action: Write a role fragment reminding the agent of allowed events.

**R2: Routing stall detection** (effectiveness: 0.60)
- When: sameRoleCount >= 3
- Action: REDIRECT verdict with diagnosis of why the role is stuck.
```

Injection point: after `reviewEffectivenessText(...)`, before `backpressureText(...)`.

#### Safe edit targets

Add `metareview-playbook.md` to the safe-edit-targets string in `renderReviewPromptText`:

```
Safe edit targets include `autoloops.toml`, `topology.toml`, `harness.md`, `metareview.md`, `metareview-playbook.md`, `roles/*.md`, ...
```

#### Playbook validation after edits

In `runMetareviewReview()`, after the LLM runs and before returning the verdict, re-read `metareview-playbook.md` if it was modified and validate with `parsePlaybook()`. Log warnings for malformed rules but don't block the verdict.

### Graceful Degradation

| Condition | Behavior |
|-----------|----------|
| No prior `review.verdict` events | Effectiveness section omitted |
| Only 1 prior verdict (no trend data) | Show metrics, trend = "insufficient-data" |
| `metareview-playbook.md` doesn't exist | Playbook section omitted |
| Playbook exists but all rules malformed | Playbook section omitted, warnings logged |
| Playbook condition references unknown field | Rule skipped, warning logged |

### Files Changed

| File | Change |
|------|--------|
| `src/harness/effectiveness.ts` | **New.** `computeReviewEffectiveness()`, `reviewEffectivenessText()`, `EffectivenessReport` |
| `src/harness/playbook.ts` | **New.** `parsePlaybook()`, `evaluatePlaybookConditions()`, `renderMatchedPlaybookRules()`, `PlaybookRule`, `PlaybookContext` |
| `src/harness/prompt.ts` | Add effectiveness + playbook text to `renderReviewPromptText()`. Add `metareview-playbook.md` to safe-edit-targets string. Add `sameRoleCount` to `DerivedRunContext`. |
| `src/harness/metareview.ts` | Emit `review.effectiveness` event before `review.start`. Optional post-review playbook validation. |

## Implementation Order

**Slice 1: Effectiveness feedback** (effectiveness.ts + prompt.ts + metareview.ts changes)
- Standalone, no dependency on playbook
- Provides measurement infrastructure for Slice 2

**Slice 2: Playbook** (playbook.ts + prompt.ts + metareview.ts changes)
- Depends on Slice 1 only for the effectiveness scores that feed into playbook rule metadata
- Can be implemented independently — playbook rules work without effectiveness data
