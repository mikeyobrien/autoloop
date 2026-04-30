# Releasing

Releases are published to npm by GitHub Actions from version tags.
Every workspace package publishes in lock-step with the root package.

## Prerequisites

- `main` branch is green (CI passes).
- All workspace `package.json` files are on the same version.
- `CHANGELOG.md` has an entry for the new version.

## Release flow

1. Bump every workspace to the new version in one pass:

```bash
node bin/release 0.7.0
```

The script:
- updates `version` in the root and every `packages/*/package.json`
- rewrites cross-workspace deps (`*`, or older pins) to the new exact version
- syncs `plugins/autoloop/.claude-plugin/plugin.json`
- runs `npm install` to refresh the lockfile
- runs `npm run check` (biome + tsc --noEmit + vitest with coverage)

2. Update `CHANGELOG.md` with a section for the new version.

3. Commit the release prep:

```bash
git commit -am "release: v0.7.0"
```

4. Create an annotated semver tag:

```bash
git tag -a v0.7.0 -m "v0.7.0"
```

5. Push the commit and tag:

```bash
git push origin main --follow-tags
```

6. Watch `.github/workflows/publish-npm.yml`. The workflow:
   - checks out the repo
   - installs dependencies (`npm ci`)
   - builds every workspace and the root (`npm run build`)
   - runs tests (`npm test`)
   - verifies the tag version matches root `package.json`
   - verifies every workspace matches root's version
   - publishes `packages/*` (in topological order) with `--provenance --access public`
   - publishes the root `@mobrienv/autoloop` last (skipped if already on npm)

7. Verify every package is live:

```bash
npm view @mobrienv/autoloop@0.7.0
npm view @mobrienv/autoloop-cli@0.7.0
npm view @mobrienv/autoloop-core@0.7.0
npm view @mobrienv/autoloop-harness@0.7.0
npm view @mobrienv/autoloop-backends@0.7.0
npm view @mobrienv/autoloop-dashboard@0.7.0
npm view @mobrienv/autoloop-presets@0.7.0
```

## CI pipeline

Every push to `main` and every PR triggers `.github/workflows/ci.yml`:

| Step | Command |
|------|---------|
| Build | `npm run build` (every workspace + root `tsc`) |
| Test | `npm test` (Vitest) |

Node 24 is used in both CI and publish workflows.

## Local quality checks

```bash
npm run check   # biome lint + tsc --noEmit + vitest with coverage
npm run lint    # biome check src/ test/
npm test        # vitest run
npm run build   # build all workspaces + root
```

## npm publish details

- **Root package**: `@mobrienv/autoloop` — the end-user install.
- **Specialty packages**: published from `packages/*` under the `@mobrienv/autoloop-*` scope.
- **Access**: public (scoped)
- **Provenance**: enabled — npm attestations are generated via OIDC `id-token: write` permission
- **Trigger**: push of a `v*` tag, or manual `workflow_dispatch`
- **Idempotent**: workspaces that are already on npm 409 and are skipped; the root is guarded by an explicit `npm view` pre-check
- **Trusted publishing**: the workflow upgrades npm to latest for OIDC-based provenance support
- **GitHub Releases**: npm publish is automated; GitHub release notes still need to be created separately if you want a public release page for launch links or social posts

## What gets published

### Root package (`@mobrienv/autoloop`)

The root `files` field controls the tarball:

- `bin/autoloop` — Node.js entry point (`#!/usr/bin/env node`, imports `@mobrienv/autoloop-cli`)
- `dist/` — compiled root TypeScript output (SDK entry re-exporting from workspace packages)
- `plugins/autoloop` — Claude plugin metadata and bundled skill assets
- `README.md`

### Workspace packages

Each `packages/*/package.json` has its own `files` list; the conventional shape is `["dist"]` for TS packages and `["presets"]` for the data-only presets package.

## Engine requirement

Every package declares `"engines": { "node": ">=18" }`.
