# Compatibility Policy

This document defines public API stability tiers, versioning expectations, and deprecation processes for Autoloop.

## Stability Tiers

### Tier A: Stable (v1+)

Tier A surfaces are part of the public contract and follow semantic versioning. Breaking changes require a major version bump and a minimum 2-minor-version deprecation notice.

**Surfaces:**

- **Journal JSONL contract (v1)**: On-disk record schema and semantics defined in `packages/core/src/events/encode.ts`. Every line is a JSON object with fields: `v` (version), `ts` (ISO-8601 timestamp), `run` (run ID), `topic` (event topic), optional `iteration`, then either `fields` (object) or `payload` + `source`. Agent payload records accepted through a live harness may also carry the additive optional `authority_id` field.
- **Registry schema**: On-disk `RunRecord` shape and JSONL append protocol in `packages/core/src/registry/types.ts`. Back-compat-optional fields include `outcome`, `verdict`, `cost_usd`, `acceptance_verified`.
- **CLI contracts**: documented argument and exit-code behavior for `run`, `emit`, `resume`, `inspect`, `list`, `loops`, and `config`, plus documented `--json` response fields. Human-oriented terminal rendering is Tier B unless a command explicitly documents it as stable.
- **Completion and required-event semantics**: Behavior of `completion.event`, `completion.requiredEvents`, `completion.must_be_last`, and how the harness decides loop termination.
- **Origin policies**: HTTP `Origin` header enforcement on protected `/api/*` routes and WebSocket `/ws/kanban-pty` upgrades. Browser Origins must match request `Host` and scheme (true same-origin). Scheme comes from the direct socket TLS state; `X-Forwarded-Proto` is honored only when `trustProxy` / `--trust-proxy` is explicitly enabled behind a header-stripping reverse proxy. Missing `Origin` remains allowed for non-browser clients.
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
- **Other package export subpaths**: Declared `exports` not listed as Tier A above (e.g., `@mobrienv/autoloop-harness/emit`, `@mobrienv/autoloop-kanban/runtime`).
- **Human-readable CLI rendering**: headings, colors, spacing, and prose intended for terminal users. Machine consumers should use documented `--json` modes.

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

- `journal-v1-minimal.jsonl`: Representative v1 journal (`recon.done` → `plan.ready` → `red.ready` → `task.complete` → `loop.stop`) covering both record shapes (`payload`+`source` and `fields`) and all three emit sources (`agent`, `harness`, `operator`).
- `registry-v1-minimal.jsonl`: Representative v1 run registry covering `running` plus a terminal status, and a duplicate `run_id` pair that pins last-write-wins dedupe (`packages/core/src/registry/read.ts`).
- Contract tests in `test/integration/compat-contract.test.ts` validate schema, field presence, reader semantics (`readRegistry`, `activeRuns`, `findRunByPrefix`, `readRunLines`), malformed-line tolerance, and additive-field forward compatibility.

**Regeneration:**

Both fixtures are generated from the real writers — `encodeEvent` for the journal and `appendRegistryEntry` for the registry — never hand-authored. Regenerate with:

```bash
npm run fixtures:contracts
```

Determinism guarantees (asserted by the contract tests, not just documented):

- All timestamps are frozen literals (`2021-01-01T…Z`); the generator never reads the wall clock.
- No `pid`, no hostname, no machine-specific absolute paths (fixtures use `/tmp/fixture-project`).
- Key order comes from the real encoders, so two consecutive runs are byte-identical. `AUTOLOOP_FIXTURE_OUT_DIR=<dir>` writes to a scratch directory instead of the committed path; the regeneration test uses this to assert byte equality.

**Maintainer review procedure:**

1. Run `npm run fixtures:contracts`.
2. Run `git diff test/fixtures/contracts`.
3. **A non-empty diff is a review stop.** Classify it:
   - *Additive* (new optional field, new record appended): allowed within the current tier version. Commit the regenerated bytes together with the change that caused them, and note it in the change log.
   - *Breaking* (removed/renamed key, changed type, changed semantics of an existing key): do **not** overwrite the existing fixture. Add a new versioned fixture (e.g. `journal-v2-minimal.jsonl`), keep the old one and its tests for the deprecation window defined above, and update the version table in this document.
4. A diff you cannot explain means the writers changed unintentionally — investigate before committing.

CI runs the generator and fails on any uncommitted fixture drift, so a hand-edited or stale fixture cannot merge.

### CI Gates

CI enforces:

- `npm run build` — successful TypeScript compilation.
- `npm run check` — package-wide biome lint/format, `tsc --noEmit`, public export/bin resolution, and the coverage suite.
- `npm run docs:build` — documentation links and rendering must compile.
- Contract tests pass (detect schema drift).
- `npm run fixtures:contracts` followed by `git diff --exit-code test/fixtures/contracts` — committed fixtures must be exactly reproducible from the generator.
- `npm run check:exports` — every declared runtime/type export and bin target exists, and JavaScript exports load from built `dist` files.

No PR merges without all gates green.

## Usage Examples

### Tool Script (External Consumer)

A tool/agent using Autoloop as a subprocess can rely on Tier A:

```bash
#!/bin/bash
# Inside AUTOLOOP_PROJECT_DIR, with AUTOLOOP_JOURNAL_FILE set by harness.
# Emit an event through the CLI; the parent harness independently validates
# whether it is authorized for this iteration.
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

Open an issue or discussion to propose a compatibility concern or feature addition.
