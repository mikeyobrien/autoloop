# Operator Health: Preset-Aware Supervision Policy

The health system classifies running loops into buckets using preset-specific thresholds rather than a single global timeout. This allows long-running presets (like `autospec`) to remain healthy while short-running presets (like `autosimplify`) escalate quickly.

## Health Buckets

| Bucket | Meaning |
|--------|---------|
| **Active** | Running and recently updated — no concern. |
| **Watching** | Quiet longer than the preset's warning threshold but not yet stuck. Investigate soon. |
| **Stuck** | Quiet longer than the preset's stuck threshold. Likely needs intervention. |
| **Failed** | Failed or timed out within the last 24 hours. |
| **Completed** | Completed within the last 24 hours (shown with `--verbose`). |

## Policy Table

| Preset | Warning After | Stuck After |
|--------|--------------|-------------|
| `autospec` | 10 min | 20 min |
| `autocode` | 5 min | 12 min |
| `autosimplify` | 2 min | 6 min |
| `autoqa` | 6 min | 15 min |
| `autofix` | 4 min | 10 min |
| _(default)_ | 5 min | 10 min |

Unknown presets fall back to the default policy.

## Surfaces

All operator surfaces share the same classification logic from `src/loops/health.ts`:

- **`autoloop loops health`** — prints a summary with stuck, watching, failed, and active sections.
- **`autoloop loops watch <run-id>`** — prints a one-line advisory when a run transitions into the watching or stuck band.
- **Dashboard `/api/runs`** — returns JSON with `active`, `watching`, `stuck`, `recentFailed`, and `recentCompleted` arrays.

## Design Notes

- Thresholds are intentionally heuristic. They reflect typical iteration cadence per preset and may evolve as usage patterns become clearer.
- Classification is computed from the `updated_at` field in the run registry. No additional metadata is required.
- The policy module (`src/loops/policy.ts`) is the single source of truth for all thresholds.
