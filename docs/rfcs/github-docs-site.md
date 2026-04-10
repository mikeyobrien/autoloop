# RFC: GitHub Docs Site

**Slug:** `github-docs-site`  
**Status:** Draft  
**Date:** 2026-04-10  
**Phase:** Design  
**Depends on:** none

---

## Summary

Add a public documentation website for autoloop, published via GitHub Pages using VitePress. The site consolidates the existing 18 public markdown docs (~3,400 lines) and README into a browsable, searchable format with a 6-section navigation structure. Deployment is automated via GitHub Actions on push to `main`.

---

## Motivation

The project has substantial documentation spread across `docs/*.md` and `README.md`, but it's only browsable on GitHub's file viewer — no search, no sidebar navigation, no structured hierarchy. A docs site makes the project more approachable for new users, provides discoverable navigation, and establishes a foundation for growth as the project matures.

---

## Design

### Stack: VitePress

**Decision:** VitePress over Docusaurus and MkDocs Material.

| Criterion | VitePress | Docusaurus | MkDocs Material |
|-----------|-----------|------------|-----------------|
| Ecosystem match | Node.js ✅ | Node.js ✅ | Python ❌ |
| Config overhead | 1 file (`config.mts`) | ~5 files + MDX | 1 file (`mkdocs.yml`) |
| Plain markdown | Native | MDX-oriented | Native |
| Built-in search | MiniSearch (zero-config) | Requires Algolia or plugin | Lunr (built-in) |
| Build speed (18 files) | <5s | ~15s | ~3s |
| node_modules | ~40MB | ~150MB | N/A (pip) |
| Versioning | Manual (branches) | Built-in | Plugin (mike) |

VitePress wins on ecosystem alignment, minimal config, and right-sizing. Docusaurus is overweight for 18 files. MkDocs Material is excellent but introduces a Python dependency into a TypeScript project.

### Information Architecture

```
docs/
├── index.md                          ← adapted from README (landing page)
├── getting-started/
│   ├── installation.md               ← extracted from README
│   └── quick-start.md                ← extracted from README
├── guides/
│   ├── creating-presets.md           ← docs/creating-presets.md
│   ├── auto-workflows.md            ← docs/auto-workflows.md
│   └── operating-playbook.md         ← docs/miniloops-wt-operating-playbook.md (renamed)
├── features/
│   ├── worktree.md                   ← docs/worktree.md
│   ├── dynamic-chains.md            ← docs/dynamic-chains.md
│   ├── dashboard.md                 ← docs/dashboard.md
│   ├── profiles.md                  ← docs/profiles.md
│   ├── tasks.md                     ← docs/tasks.md
│   ├── llm-judge.md                 ← docs/llm-judge.md
│   └── operator-health.md           ← docs/operator-health.md
├── reference/
│   ├── cli.md                       ← docs/cli.md
│   ├── configuration.md             ← docs/configuration.md
│   ├── topology.md                  ← docs/topology.md
│   ├── memory.md                    ← docs/memory.md
│   ├── journal.md                   ← docs/journal.md
│   └── metareview.md               ← docs/metareview.md
├── concepts/
│   └── platform.md                  ← docs/platform.md
└── development/
    └── releasing.md                 ← docs/releasing.md
```

**Total: 21 pages** (18 existing docs + index + installation + quick-start).

Excluded from public site:
- `docs/rfcs/` — internal planning artifacts
- `docs/plans/` — internal roadmaps
- `docs/reports/` — report artifacts
- `docs/launches/` — launch media
- `archive-active-context-2026-03-27.md` — stale

### File Organization

The VitePress source root is `docs/` (existing directory). The site config lives at `docs/.vitepress/config.mts`. This means existing `docs/*.md` files stay in place — only reorganization into subdirectories and the addition of `.vitepress/` config are needed.

**Key directory structure:**
```
docs/
├── .vitepress/
│   ├── config.mts          ← sidebar, nav, theme config
│   └── theme/              ← (optional) custom CSS only
├── public/
│   └── hero.png            ← static assets (images, etc.)
├── index.md                ← landing page
├── getting-started/
├── guides/
├── features/
├── reference/
├── concepts/
└── development/
```

Important repo-specific requirement: this repo already has non-site content under `docs/` (`rfcs/`, `plans/`, `reports/`, `launches/`, and archive files). The initial VitePress config must exclude those paths from the first build rather than waiting for a later migration step.

### Content Migration Strategy

**Approach: Move files into subdirectories, update relative links.**

1. **README → `docs/index.md`**: Extract intro, feature highlights, and install/quick-start as the landing page. Use VitePress hero layout. Remove sections that duplicate deeper docs (project structure, dev scripts → link to Development section).

2. **Getting Started pages**: Extract installation and quick-start sections from README into standalone pages. These are the highest-value new pages since they create a clear onboarding path.

3. **Existing docs → subdirectories**: Move each doc into its category subdirectory per the IA above. Files need no content changes — VitePress reads the `# Title` heading as the page title.

4. **Link rewriting**: Cross-references like `[Platform Architecture](platform.md)` need path updates (e.g., `../concepts/platform.md`). This is a mechanical find-and-replace per file.

5. **Rename**: `miniloops-wt-operating-playbook.md` → `guides/operating-playbook.md` (drop legacy "miniloops" prefix).

6. **Inbound-link audit**: update repo-facing references that point at old `docs/*.md` paths where the moved files would otherwise leave stale links. The minimum scope is `README.md`; any remaining non-site markdown references may either be updated or explicitly accepted as internal historical references if they live inside excluded `docs/rfcs/` or `docs/plans/` content.

7. **Images**: Copy `docs/launches/autoloop-readme-hero.png` to `docs/public/hero.png` for the site. Keep README's existing repo-relative media references unless there is a separate deliberate README cleanup.

### VitePress Configuration

```typescript
// docs/.vitepress/config.mts
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'autoloop',
  description: 'Autonomous loop orchestration for AI agents',
  base: '/autoloop/',  // GitHub Pages subpath (adjust if custom domain)
  srcExclude: [
    '**/rfcs/**',
    '**/plans/**',
    '**/reports/**',
    '**/launches/**',
    '**/archive-*'
  ],
  
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started/installation' },
      { text: 'Reference', link: '/reference/cli' },
      { text: 'GitHub', link: 'https://github.com/mikeyobrien/autoloop' }
    ],
    sidebar: {
      '/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Installation', link: '/getting-started/installation' },
            { text: 'Quick Start', link: '/getting-started/quick-start' }
          ]
        },
        {
          text: 'Guides',
          items: [
            { text: 'Creating Presets', link: '/guides/creating-presets' },
            { text: 'Auto Workflows', link: '/guides/auto-workflows' },
            { text: 'Operating Playbook', link: '/guides/operating-playbook' }
          ]
        },
        {
          text: 'Features',
          items: [
            { text: 'Worktree Isolation', link: '/features/worktree' },
            { text: 'Dynamic Chains', link: '/features/dynamic-chains' },
            { text: 'Dashboard', link: '/features/dashboard' },
            { text: 'Profiles', link: '/features/profiles' },
            { text: 'Tasks', link: '/features/tasks' },
            { text: 'LLM Judge', link: '/features/llm-judge' },
            { text: 'Operator Health', link: '/features/operator-health' }
          ]
        },
        {
          text: 'Reference',
          items: [
            { text: 'CLI', link: '/reference/cli' },
            { text: 'Configuration', link: '/reference/configuration' },
            { text: 'Topology & Routing', link: '/reference/topology' },
            { text: 'Memory System', link: '/reference/memory' },
            { text: 'Journal Format', link: '/reference/journal' },
            { text: 'Metareview', link: '/reference/metareview' }
          ]
        },
        {
          text: 'Concepts',
          items: [
            { text: 'Platform Architecture', link: '/concepts/platform' }
          ]
        },
        {
          text: 'Development',
          items: [
            { text: 'Releasing', link: '/development/releasing' }
          ]
        }
      ]
    },
    search: { provider: 'local' },  // MiniSearch, zero-config
    socialLinks: [
      { icon: 'github', link: 'https://github.com/mikeyobrien/autoloop' }
    ],
    editLink: {
      pattern: 'https://github.com/mikeyobrien/autoloop/edit/main/docs/:path'
    }
  }
})
```

### GitHub Actions Deployment

```yaml
# .github/workflows/docs.yml
name: Deploy docs
on:
  push:
    branches: [main]
    paths:
      - 'docs/**'
      - 'package.json'
      - 'package-lock.json'
      - '.github/workflows/docs.yml'
  workflow_dispatch:

permissions:
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: npx vitepress build docs
      - uses: actions/upload-pages-artifact@v3
        with: { path: docs/.vitepress/dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

**Path filter**: Rebuild on docs changes and docs-runtime/deployment changes (`package.json`, `package-lock.json`, workflow edits), but not on unrelated code-only pushes.

**Coexistence**: This workflow is independent from `ci.yml` and `publish-npm.yml`.

**External deployment gate**: repository Settings → Pages must be switched to `GitHub Actions` before the first production deploy can succeed. Treat that as a rollout prerequisite, not a post-hoc note.

### Local Dev Workflow

```bash
# Install (VitePress is a devDependency)
npm install

# Dev server with hot reload
npx vitepress dev docs

# Production build
npx vitepress build docs

# Preview production build
npx vitepress preview docs
```

Add to `package.json` scripts:
```json
{
  "docs:dev": "vitepress dev docs",
  "docs:build": "vitepress build docs",
  "docs:preview": "vitepress preview docs"
}
```

### Search

**Phase 1:** VitePress built-in local search (MiniSearch). Zero-config, works offline, performant for <100 pages. Already specified in config above.

**Phase 2 (optional):** Apply for Algolia DocSearch (free for OSS) if search quality or ranking becomes a concern at scale.

### Analytics

**Phase 1:** None. The project is early-stage and analytics overhead isn't justified yet.

**Phase 2 (optional):** Add Plausible or GA4 via VitePress `head` config when traffic warrants it. Plausible preferred (privacy-focused, no cookie banner needed).

### Versioning

**Phase 1:** No versioning. Docs track `main`. The project is pre-1.0 with no stable API guarantees.

**Phase 2 (optional):** At v1.0, consider branch-based versioning or the `vitepress-versioning` community plugin.

---

## Open Questions

1. **Custom domain**: Should docs live at a custom domain (e.g., `autoloop.dev`) or `mikeyobrien.github.io/autoloop`? Affects `base` config and CNAME setup. Default: GitHub Pages subpath.
2. **RFCs public**: Should any RFCs be exposed as an "Architecture Decisions" section? Default: exclude.
3. **Hero media**: Include the launch hero image/video on the landing page? Default: include hero image, skip video.

---

## Success Criteria

1. **Docs site live** at a stable URL within 1 week of implementation start.
2. **All 18 existing docs** are accessible and navigable via sidebar.
3. **Search works** — any term from existing docs returns relevant results.
4. **Build passes CI** — `vitepress build docs` exits 0 in the GitHub Actions workflow.
5. **Local dev works** — `npx vitepress dev docs` starts a working dev server in <3s.
6. **No broken links** — all cross-references resolve correctly post-migration.
7. **README updated** — points to the docs site for detailed documentation and no longer depends on stale moved `docs/*.md` links.
8. **Edit links work** — sample pages resolve to the expected GitHub edit URLs.

---

## Phased Execution

### Phase 1: Foundation (1-2 days)
1. Install VitePress as a devDependency (`npm install -D vitepress`).
2. Create `docs/.vitepress/config.mts` with sidebar/nav config and `srcExclude` for repo-internal `docs/` content.
3. Create `docs/index.md` landing page (adapted from README).
4. Add `docs:dev`, `docs:build`, `docs:preview` npm scripts.
5. Verify local dev server works.

### Phase 2: Content Migration (1-2 days)
1. Create subdirectories: `getting-started/`, `guides/`, `features/`, `reference/`, `concepts/`, `development/`.
2. Move all 18 public docs into subdirectories per IA mapping.
3. Extract installation and quick-start from README into standalone pages.
4. Rename `miniloops-wt-operating-playbook.md` → `guides/operating-playbook.md`.
5. Rewrite cross-reference links to use new paths.
6. Audit and update inbound links from `README.md` and other non-excluded markdown that still reference old `docs/*.md` paths.
7. Copy hero image to `docs/public/`.

### Phase 3: CI/CD (0.5 day)
1. Add `.github/workflows/docs.yml` with build + deploy jobs.
2. Enable GitHub Pages in repo settings (deploy from GitHub Actions) as an explicit rollout gate.
3. Push to `main`, verify deployment.
4. Confirm the site is live at the Pages URL.

### Phase 4: Polish (0.5 day)
1. Verify all moved-doc links work (`vitepress build`) and spot-check README + key repo links.
2. Update README to link to the docs site and remove/replace stale moved-doc deep links where appropriate.
3. Verify "Edit this page" links on a representative sample of pages.
4. Review landing page copy and hero layout.

### Phase 5: Post-Launch (ongoing)
1. Monitor for broken links or stale content.
2. Evaluate Algolia DocSearch if search needs outgrow MiniSearch.
3. Add analytics if traffic tracking becomes useful.
4. Consider versioning at v1.0.

---

## Alternatives Considered

- **Docusaurus**: More mature versioning and plugin ecosystem, but ~4x heavier setup for a small doc set. Would be worth revisiting if the project grows to 100+ pages or needs React components in docs.
- **MkDocs Material**: Excellent DX and theme, but introduces Python as a dependency. Would consider if the project were polyglot.
- **GitHub Wiki**: Zero setup, but no CI, no search, no custom navigation, poor discoverability.
- **Plain GitHub rendering**: Current state. Works but lacks search, navigation, and structured hierarchy.
