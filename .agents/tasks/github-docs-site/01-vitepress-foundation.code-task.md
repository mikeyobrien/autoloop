# Task 1: VitePress Foundation & Config

**RFC:** `docs/rfcs/github-docs-site.md`
**Files to create:** `docs/.vitepress/config.mts`, `docs/index.md`
**Files to modify:** `package.json`, `.gitignore`
**New dependencies:** `vitepress` (devDependency)
**Estimated scope:** ~120 lines added

## Objective

Install VitePress, create the site config with full sidebar/nav, and create the landing page adapted from the README. Verify local dev server starts successfully.

## Steps

### 1. Install VitePress

```bash
npm install -D vitepress
```

### 2. Create `docs/.vitepress/config.mts`

Copy the config from the RFC. Key points:
- `base: '/autoloop/'` for GitHub Pages subpath
- `srcExclude` must be present from the first commit because this repo already contains non-site docs content under `docs/`:
  - `**/rfcs/**`
  - `**/plans/**`
  - `**/reports/**`
  - `**/launches/**`
  - `**/archive-*`
- Full sidebar with all 6 sections and 21 page links
- `search: { provider: 'local' }` for MiniSearch
- `editLink` pointing to the repo's `main` branch
- Social link to GitHub repo

### 3. Create `docs/index.md` — Landing page

Adapt from README.md:
- Use VitePress [hero layout](https://vitepress.dev/reference/default-theme-home-page) with `layout: home` frontmatter
- Hero section: title, tagline, action buttons (Get Started → `/getting-started/installation`, GitHub → repo)
- Features grid: 3-4 feature cards highlighting key capabilities (worktree isolation, topology-driven routing, memory system, dashboard)
- Keep it concise — link to deeper docs rather than duplicating README content

### 4. Add npm scripts to `package.json`

```json
{
  "docs:dev": "vitepress dev docs",
  "docs:build": "vitepress build docs",
  "docs:preview": "vitepress preview docs"
}
```

### 5. Add VitePress build output to `.gitignore`

Append:
```
docs/.vitepress/dist
docs/.vitepress/cache
```

### 6. Verify

```bash
npm run docs:build
npm run docs:dev
# Build should exit 0
# Dev server should start successfully and render the landing page
```

## Acceptance Criteria

- `npm run docs:dev` starts a working dev server
- Landing page renders with hero layout
- Internal repo-only docs trees (`rfcs`, `plans`, `reports`, `launches`, archive docs) are excluded from the first build
- Sidebar shows all 6 sections (even if pages don't exist yet — links will 404 until Task 2)
- `npm run docs:build` exits 0
