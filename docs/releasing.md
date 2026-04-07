# Releasing

Releases are published to npm by GitHub Actions from version tags.

## Prerequisites

- `main` branch is green (CI passes).
- `package.json` version matches the tag you are about to create.

## Release flow

1. Bump the version in `package.json`.
2. Commit the version bump:

```bash
git commit -am "release: v0.2.1"
```

3. Create an annotated semver tag:

```bash
git tag -a v0.2.1 -m "v0.2.1"
```

4. Push the commit and tag:

```bash
git push origin main --follow-tags
```

5. Watch `.github/workflows/publish-npm.yml`. The workflow:
   - checks out the repo
   - installs dependencies (`npm ci`)
   - builds TypeScript (`npm run build` → `tsc`)
   - runs tests (`npm test` → Vitest with `--experimental-vm-modules`)
   - verifies the tag version matches `package.json`
   - skips publish if the version is already on npm
   - publishes to npm with `--provenance --access public`

6. Verify the package is live:

```bash
npm view @mobrienv/autoloop@0.2.1
```

## CI pipeline

Every push to `main` and every PR triggers `.github/workflows/ci.yml`:

| Step | Command |
|------|---------|
| Build | `npm run build` (tsc → `dist/`) |
| Test | `npm test` (Vitest) |

Node 24 is used in both CI and publish workflows.

## Local quality checks

```bash
npm run check   # biome lint + tsc --noEmit + vitest with coverage
npm run lint     # biome check src/ test/
npm test         # vitest run
```

## npm publish details

- **Package name**: `@mobrienv/autoloop`
- **Access**: public (scoped)
- **Provenance**: enabled — npm attestations are generated via OIDC `id-token: write` permission
- **Trigger**: push of a `v*` tag, or manual `workflow_dispatch`
- **Idempotent**: if the version is already published, the workflow exits cleanly without error
- **Trusted publishing**: the workflow upgrades npm to latest for OIDC-based provenance support

## What gets published

The `files` field in `package.json` controls the npm tarball contents:

- `bin/autoloop` — Node.js entry point (`#!/usr/bin/env node`, imports `dist/main.js`)
- `dist/` — compiled TypeScript output (ES2022, Node16 module resolution, with source maps and declarations)
- `presets/` — bundled preset configurations
- `README.md`

## Engine requirement

The package declares `"engines": { "node": ">=18" }`.
