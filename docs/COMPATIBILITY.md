# Compatibility Policy

This document defines public API stability tiers, versioning expectations, and deprecation processes for Autoloop.

## Stability Tiers

### Tier A: Stable (v1+)

Tier A surfaces are part of the public contract and follow semantic versioning. Breaking changes require a major version bump and a minimum 2-minor-version deprecation notice.

**Surfaces:**

- **Journal JSONL contract (v1)**: On-disk record schema and semantics defined in `packages/core/src/events/encode.ts`. Every line is a JSON object with fields: `v` (version), `ts` (ISO-8601 timestamp), `run` (run ID), `topic` (event topic), optional `iteration`, then either `fields` (object) or `payload` + `source`.
- **Registry schema**: On-disk `RunRecord` shape and JSONL append protocol in `packages/core/src/registry/types.ts`. Back-compat-optional fields include `outcome`, `verdict`, `cost_usd`, `acceptance_verified`.
- **CLI verbs**: `run`, `emit`, `resume`, `inspect`, `ls`, `rm`, `config` commands and their exit codes, stdout format, and argument contracts.
- **Completion and required-event semantics**: Behavior of `completion.event`, `completion.requiredEvents`, `completion.must_be_last`, and how the harness decides loop termination.
- **Origin policies**: HTTP `Origin` header enforcement on protected `/api/*` routes and WebSocket `/ws/kanban-pty` upgrades.
- **Core package exports**: Subpaths re-exported from `@mobrienv/autoloop-core` (e.g., `./journal`, `./journal-format`, `./registry`, `./topology`, `./config-schema`, `./hooks-schema`).

**Breaking changes are forbidden without:**
1. RFC and discussion in the issue tracker.
2. Deprecation notice in release notes (minimum 2 minor versions).
3. Migration guide with examples.

**Non-breaking additions** (new optional fields, new events, new CLI flags) may land in patch or minor versions.

### Tier B: Semi-Stable (v1+)

Tier B surfaces are intended for integration use but may see breaking changes in minor versions with explicit changelog notes.

**Surfaces:**

- **Harness emit() API**: `packages/harness/src/emit.ts` public interface and behavior.
- **LoopEvent schema**: Event envelope shape in `packages/harness/src/events.ts`.
- **Package exports subpaths**: Declared `exports` map in each workspace `package.json` (e.g., `@mobrienv/autoloop-harness/emit`, `@mobrienv/autoloop-kanban/runtime`).

**Policy:** Changes to Tier B require a changelog note but no RFC or deprecation grace period.

### Tier C: Internal

Tier C surfaces have no stability guarantee and may change in patch versions.

**Examples:**

- Internal module layout, helper functions, and private exports (omitted from `package.json` exports).
- Display/rendering logic and prompt text.
- Test fixtures and helpers.

## Versioning Scheme

Autoloop uses [semantic versioning](https://semver.org/):

- **MAJOR.MINOR.PATCH** (e.g., `0.10.1`)
- **MAJOR 0**: pre-1.0 development; minor version bumps may include breaking changes to Tier B surfaces with changelog notice.
- **MAJOR 1+**: stable releases; breaking changes to Tier A require major version bump; breaking changes to Tier B require changelog note and minor version bump.

## Deprecation Process (Tier A)

1. **RFC**: Propose breaking change via issue/discussion.
2. **Deprecation notice**: Release N (minor version).
3. **Final removal**: Release N+2 (minor version).
4. **Migration guide**: Included in release notes of both deprecation and removal versions.

Example:
- v0.10.0: Journal v1.1 (adds optional `source` field).
- v0.11.0: Announce deprecation of v0 Journal schema; plan v1.1 as new default in v0.13.0.
- v0.12.0: Harness accepts both v0 and v1.1; tool script generates v1.1.
- v0.13.0: v1.1 becomes default; v0 still accepted; announce removal in v0.15.0.
- v0.15.0: v0 schema no longer accepted; migration via `autoloops migrate schema v0.14.0-export`.

## Testing and Validation

### Golden Fixtures

Deterministic contract fixtures are committed at `test/fixtures/contracts/`:

- `journal-v1-minimal.jsonl`: Representative v1 journal with fixed timestamps (2021-01-01T00:00:00Z).
- Contract tests in `test/integration/compat-contract.test.ts` validate schema, field presence, and API consumption.

**Regeneration:**

No automated regeneration is currently needed; fixtures are hand-authored once per contract version. To update after a breaking schema change:

1. Create new fixture file (e.g., `journal-v2.0-minimal.jsonl`) with the new schema.
2. Update tests to exercise both old and new fixtures (during deprecation grace period).
3. Document the version boundary in this file.

### CI Gates

CI enforces:

- `npm run build` — successful TypeScript compilation.
- `npm run check` — biome lint/format, tsc --noEmit, test coverage thresholds.
- Contract tests pass (detect schema drift).
- Export-resolution test (all declared subpaths importable from dist).

No PR merges without all gates green.

## Usage Examples

### Tool Script (External Consumer)

A tool/agent using Autoloop as a subprocess can rely on Tier A:

```bash
#!/bin/bash
# Inside AUTOLOOP_PROJECT_DIR, with AUTOLOOP_JOURNAL_FILE set by harness.
source "$AUTOLOOP_BIN"

# Emit event using harness-controlled journal path (Tier A).
"$AUTOLOOP_BIN" emit plan.ready "Planning complete"

# Read journal (Tier A contract v1).
cat "$AUTOLOOP_JOURNAL_FILE" | while IFS= read -r line; do
  topic=$(echo "$line" | jq -r .topic)
  source=$(echo "$line" | jq -r .source)
  echo "Topic: $topic, Source: $source"
done
```

Tool script may **not** assume internal module layout or harness prompt formatting (Tier C).

### SDK Integration (Using Published Packages)

```typescript
import { readRunLines } from "@mobrienv/autoloop-core/journal"; // Tier A
import { buildIterationContext } from "@mobrienv/autoloop-harness/prompt"; // Tier B

const lines = readRunLines(journalPath, runId); // Stable
const context = buildIterationContext(loop, iteration); // May change in minor version
```

Declared subpaths are Tier B; undeclared internal modules are Tier C.

## Questions?

Refer to RFCs in the `docs/rfcs/` folder for detailed design decisions. Open an issue to propose a compatibility concern or feature addition.
