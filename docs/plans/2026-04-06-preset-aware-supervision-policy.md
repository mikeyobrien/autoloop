# Preset-Aware Supervision Policy Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make `autoloop loops health`, `loops watch`, and the dashboard classify run health using preset-specific expectations instead of a single global timeout.

**Architecture:** Introduce a small supervision-policy module that maps presets to explicit health expectations (stuck thresholds, expected event cadence, and watch hints). Keep the registry canonical. Compute health judgments from existing `RunRecord` data first, then add minimal metadata only if a real gap appears during implementation.

**Tech Stack:** TypeScript, Vitest, existing registry/loops/dashboard code.

---

## Scope and non-goals

### In scope
- Replace the one-size-fits-all `STUCK_THRESHOLD_MS` logic with preset-aware policy.
- Surface policy-derived status consistently in:
  - `src/loops/health.ts`
  - `src/loops/watch.ts`
  - `src/dashboard/routes/api.ts`
- Add unit tests for policy resolution and health categorization.
- Add integration coverage for one slow-but-healthy preset and one genuinely stuck run.
- Document the policy contract.

### Not in scope for this slice
- Objective/artifact drift detection.
- ML-style confidence scoring.
- Full intervention history.
- Adding many new registry fields unless tests prove current data is insufficient.

---

## Current code facts to preserve

- `src/loops/health.ts` currently hardcodes `STUCK_THRESHOLD_MS = 10 * 60 * 1000` and classifies runs only by `updated_at` recency.
- `src/loops/watch.ts` currently prints raw run-line changes and terminal details, but does not explain whether a run is merely quiet vs suspicious for its preset.
- `src/dashboard/routes/api.ts` returns `categorizeRuns(ctx.registryPath)` directly, so improving `categorizeRuns` will automatically improve the dashboard API.
- `RunRecord` already contains enough fields for a v1 policy layer: `preset`, `status`, `iteration`, `updated_at`, `latest_event`, `stop_reason`, `parent_run_id`, `isolation_mode`, `worktree_*`.

---

## Desired behavior

### Policy examples for v1
These should be explicit in code, not hidden in prose:

- `autospec`
  - longer quiet periods are normal
  - early iterations with sparse event changes should not be marked stuck too aggressively
- `autocode`
  - medium threshold
  - repeated idle periods should escalate sooner than `autospec`
- `autosimplify`
  - short runs expected
  - long silence is suspicious quickly
- `autoqa`
  - medium-long threshold because review/verification can be bursty
- unknown preset
  - fall back to default generic policy

### Output behavior
- `loops health` should distinguish at least:
  - `active`
  - `watching` or equivalent “slow but acceptable” bucket
  - `stuck`
  - `recentFailed`
  - `recentCompleted`
- `loops watch` should print a preset-aware hint when a run crosses from healthy to warning territory.
- Dashboard `/api/runs` should expose the richer categorization without inventing a separate policy path.

---

## Task 1: Add a supervision policy module

**Objective:** Centralize preset-specific health thresholds and labels so all operator surfaces use the same rules.

**Files:**
- Create: `src/loops/policy.ts`
- Test: `test/loops/policy.test.ts`

**Step 1: Write failing tests**

Add tests that prove:
- `autospec` resolves to a looser policy than `autosimplify`
- unknown presets fall back to a default policy
- policy objects expose stable fields, for example:
  - `stuckAfterMs`
  - `warningAfterMs`
  - `label`

Suggested test shape:

```ts
import { describe, it, expect } from "vitest";
import { policyForPreset } from "../../src/loops/policy.js";

describe("policyForPreset", () => {
  it("gives autospec a looser threshold than autosimplify", () => {
    const autospec = policyForPreset("autospec");
    const autosimplify = policyForPreset("autosimplify");
    expect(autospec.stuckAfterMs).toBeGreaterThan(autosimplify.stuckAfterMs);
  });

  it("falls back to default policy for unknown presets", () => {
    const policy = policyForPreset("mystery-preset");
    expect(policy.label).toBe("default");
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
npm test -- test/loops/policy.test.ts
```

Expected: fail because `src/loops/policy.ts` does not exist yet.

**Step 3: Write minimal implementation**

Create a small module like:

```ts
export interface SupervisionPolicy {
  label: string;
  warningAfterMs: number;
  stuckAfterMs: number;
}

const DEFAULT_POLICY: SupervisionPolicy = {
  label: "default",
  warningAfterMs: 5 * 60 * 1000,
  stuckAfterMs: 10 * 60 * 1000,
};

const POLICIES: Record<string, SupervisionPolicy> = {
  autospec: { label: "autospec", warningAfterMs: 10 * 60 * 1000, stuckAfterMs: 20 * 60 * 1000 },
  autocode: { label: "autocode", warningAfterMs: 5 * 60 * 1000, stuckAfterMs: 12 * 60 * 1000 },
  autosimplify: { label: "autosimplify", warningAfterMs: 2 * 60 * 1000, stuckAfterMs: 6 * 60 * 1000 },
  autoqa: { label: "autoqa", warningAfterMs: 6 * 60 * 1000, stuckAfterMs: 15 * 60 * 1000 },
  autofix: { label: "autofix", warningAfterMs: 4 * 60 * 1000, stuckAfterMs: 10 * 60 * 1000 },
};

export function policyForPreset(preset: string): SupervisionPolicy {
  return POLICIES[preset] ?? DEFAULT_POLICY;
}
```

Keep it deliberately small.

**Step 4: Run test to verify pass**

```bash
npm test -- test/loops/policy.test.ts
```

Expected: pass.

**Step 5: Commit**

```bash
git add src/loops/policy.ts test/loops/policy.test.ts
git commit -m "feat: add preset-aware supervision policy definitions"
```

---

## Task 2: Extend health classification to use warning + stuck buckets

**Objective:** Replace global timeout classification in `health.ts` with policy-aware results.

**Files:**
- Modify: `src/loops/health.ts`
- Test: `test/loops/health.test.ts`

**Step 1: Write failing tests**

Add tests covering:
- `autospec` run with stale-ish `updated_at` stays non-stuck
- `autosimplify` run with the same `updated_at` becomes warning or stuck sooner
- failed/completed logic remains unchanged

Suggested test shape:

```ts
import { describe, it, expect, vi } from "vitest";
import { categorizeRecords } from "../../src/loops/health.js";

it("treats autospec as healthy for longer quiet periods", () => {
  const now = new Date("2026-04-06T12:00:00Z").getTime();
  vi.spyOn(Date, "now").mockReturnValue(now);
  const records = [
    makeRun({ preset: "autospec", status: "running", updated_at: "2026-04-06T11:52:00Z" }),
  ];
  const result = categorizeRecords(records);
  expect(result.stuck).toHaveLength(0);
});
```

To make this easy, extract a pure helper:
- `categorizeRecords(records: RunRecord[], nowMs = Date.now())`

**Step 2: Run test to verify failure**

```bash
npm test -- test/loops/health.test.ts
```

Expected: fail because helper/buckets do not exist yet.

**Step 3: Write minimal implementation**

Refactor `src/loops/health.ts` to:
- import `policyForPreset`
- add a new bucket such as `watching: RunRecord[]`
- classify running runs by preset policy:
  - `elapsed > stuckAfterMs` → `stuck`
  - `elapsed > warningAfterMs` → `watching`
  - else → `active`
- keep recent failed/completed logic intact
- preserve current plain-text rendering style, but include the new bucket in summary output

Implementation hint:

```ts
export interface HealthResult {
  active: RunRecord[];
  watching: RunRecord[];
  stuck: RunRecord[];
  recentFailed: RunRecord[];
  recentCompleted: RunRecord[];
}
```

**Step 4: Run tests to verify pass**

```bash
npm test -- test/loops/health.test.ts
```

Expected: pass.

**Step 5: Commit**

```bash
git add src/loops/health.ts test/loops/health.test.ts
git commit -m "feat: classify run health with preset-aware thresholds"
```

---

## Task 3: Make `loops watch` surface preset-aware warnings

**Objective:** Turn `loops watch` into a policy-aware operator surface instead of a raw poll printer.

**Files:**
- Modify: `src/loops/watch.ts`
- Test: `test/integration/loops-watch.test.ts`

**Step 1: Write failing test**

Add one integration or focused unit test that proves watch output includes a warning when a run is quiet past its preset warning threshold but not yet stuck.

Example expected output fragment:
- `[watch] autospec: quiet but still within expected range`
- or `[watch] autosimplify: no progress for 3m; investigate soon`

Do not over-engineer prose; the point is preset-aware operator guidance.

**Step 2: Run test to verify failure**

```bash
npm test -- test/integration/loops-watch.test.ts
```

**Step 3: Implement minimal change**

In `src/loops/watch.ts`:
- reuse the same classification helper as `health.ts`
- when a run crosses into the warning band, print one extra line
- avoid spamming the same warning every poll; print only on state transition

Suggested approach:
- expand `snapshot()` to include a derived health state
- keep previous derived state and only print advisory text when it changes

**Step 4: Run tests**

```bash
npm test -- test/integration/loops-watch.test.ts
```

**Step 5: Commit**

```bash
git add src/loops/watch.ts test/integration/loops-watch.test.ts
git commit -m "feat: add preset-aware watch warnings"
```

---

## Task 4: Keep dashboard and API aligned with the new health model

**Objective:** Ensure browser/operator surfaces get the same richer health categories with no duplicate logic.

**Files:**
- Modify: `src/dashboard/routes/api.ts`
- Modify if needed: `src/dashboard/views/components.ts`
- Test: `test/dashboard/api.test.ts` or nearest existing dashboard test file

**Step 1: Write failing test**

Add a test proving `/api/runs` returns the new bucket, e.g. `watching`, for quiet-but-not-stuck runs.

If there is no dashboard API test file yet, create a small one that instantiates the Hono app and hits `/api/runs`.

**Step 2: Run test to verify failure**

```bash
npm test -- test/dashboard/api.test.ts
```

**Step 3: Implement minimal change**

- Since API already calls `categorizeRuns`, the likely code change is small.
- Update any dashboard UI code that assumes only `active/stuck/recentFailed/recentCompleted`.
- Keep the API shape obvious and serializable.

**Step 4: Run tests**

```bash
npm test -- test/dashboard/api.test.ts
```

**Step 5: Commit**

```bash
git add src/dashboard/routes/api.ts src/dashboard/views/components.ts test/dashboard/api.test.ts
git commit -m "feat: expose preset-aware health states in dashboard api"
```

---

## Task 5: Document the supervision contract

**Objective:** Make the operator policy visible and stable enough for cron/chat monitors to rely on.

**Files:**
- Modify: `docs/plans/2026-04-04-autoloops-ts-loop-ops-backlog.md`
- Modify: `docs/cli.md`
- Optionally create: `docs/operator-health.md`

**Step 1: Write docs update**

Document:
- the policy table by preset
- what `active`, `watching`, and `stuck` mean
- that the dashboard and `loops health` share the same classification logic
- that thresholds are intentionally heuristic and may evolve

**Step 2: Verify docs examples match implementation**

Run:

```bash
npm run build
```

Then manually compare code constants vs docs table.

**Step 3: Commit**

```bash
git add docs/plans/2026-04-04-autoloops-ts-loop-ops-backlog.md docs/cli.md docs/operator-health.md
git commit -m "docs: describe preset-aware supervision policy"
```

---

## Verification checklist

Run these before calling the slice done:

```bash
npm test -- test/loops/policy.test.ts
npm test -- test/loops/health.test.ts
npm test -- test/integration/loops-watch.test.ts
npm test -- test/dashboard/api.test.ts
npm run build
npx vitest run
```

Expected:
- all new focused tests pass
- full Vitest suite passes
- build passes

---

## Acceptance criteria

The slice is done when all of the following are true:

- `health.ts` no longer relies on one global stuck threshold for all presets.
- At least `autospec`, `autocode`, `autosimplify`, `autoqa`, and fallback/default have explicit policies.
- `loops health` shows a non-terminal warning bucket distinct from `stuck`.
- `loops watch` emits preset-aware warning text on state transition.
- Dashboard `/api/runs` exposes the same richer categorization as CLI health.
- Tests cover policy resolution and preset-differentiated classification.
- Docs describe the operator-visible contract.

---

## Recommended implementation order

1. `src/loops/policy.ts`
2. `src/loops/health.ts`
3. `src/loops/watch.ts`
4. dashboard API/UI alignment
5. docs

---

## Why this is the best next slice

This converts last night’s registry/loops/dashboard groundwork into an actual judgment layer. It is small enough to land in one focused pass, product-visible immediately, and unlocks smarter cron/chat supervision without waiting for the harder off-track-detection work.
