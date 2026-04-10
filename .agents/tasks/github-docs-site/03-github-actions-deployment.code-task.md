# Task 3: GitHub Actions Deployment

**RFC:** `docs/rfcs/github-docs-site.md`
**Files to create:** `.github/workflows/docs.yml`
**Files to modify:** none
**Estimated scope:** ~35 lines

## Objective

Add a GitHub Actions workflow that builds the VitePress site and deploys to GitHub Pages on push to `main` when docs change. The workflow should coexist with the existing `ci.yml` and `publish-npm.yml` workflows.

## Prerequisites

- Task 1 complete (VitePress config exists, `docs:build` script works)
- Task 2 complete (content in final locations)

## Steps

### 1. Create `.github/workflows/docs.yml`

Use the workflow from the RFC. Key configuration:
- Trigger: push to `main` with paths covering docs content and docs runtime/deployment changes:
  - `docs/**`
  - `package.json`
  - `package-lock.json`
  - `.github/workflows/docs.yml`
  plus `workflow_dispatch`
- Permissions: `pages: write`, `id-token: write`
- Concurrency group: `pages` with `cancel-in-progress: false`
- Build job: checkout → setup-node@v4 (node 24) → `npm ci` → `npx vitepress build docs` → upload-pages-artifact
- Deploy job: `actions/deploy-pages@v4` with environment URL output

### 2. Repository settings (manual step — document only)

The implementer needs to manually configure:
1. Go to repo Settings → Pages
2. Set "Source" to "GitHub Actions" (not "Deploy from a branch")
3. No branch or folder selection needed — the workflow handles deployment

Document this in the PR description and treat it as an explicit rollout gate before declaring the task complete.

### 3. Verify

After the first push to `main` with the workflow:
1. Check Actions tab — `Deploy docs` workflow should trigger
2. Verify the deployment succeeds
3. Confirm the site is accessible at `https://mikeyobrien.github.io/autoloop/`

## Acceptance Criteria

- `.github/workflows/docs.yml` exists with correct trigger, permissions, and jobs
- Workflow triggers on docs changes and docs-runtime/deployment changes, but not unrelated code-only pushes
- Workflow uses official `actions/deploy-pages@v4` (not legacy `gh-pages` branch approach)
- Build step uses `npx vitepress build docs` and uploads from `docs/.vitepress/dist`
- Task notes include the required Pages repository setting change
