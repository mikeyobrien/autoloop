# Task 4: Polish & README Update

**RFC:** `docs/rfcs/github-docs-site.md`
**Files to modify:** `README.md`, `docs/index.md` (if needed)
**Estimated scope:** ~20 lines changed

## Objective

Verify all links work, polish the landing page, and update the README so it points to the live docs site without leaving stale links to moved docs.

## Prerequisites

- Tasks 1-3 complete
- Docs site deployed and accessible

## Steps

### 1. Verify no broken links in the public docs site

```bash
npx vitepress build docs 2>&1 | grep -i "dead link\|broken"
```

VitePress reports dead links during build. Fix any that appear.

### 2. Audit README and repo-facing links to moved docs

Check README references to moved `docs/*.md` paths and either:
- replace them with the live docs site URL, or
- update them to the new repo path if the repo-facing markdown link still needs to exist

Minimum spots to review in this repo:
- creating-presets link in the README body
- CLI reference link in the README body
- README "Further Reading" section

### 3. Update README.md

Add a documentation link near the top of the README, after the description/badges:

```markdown
**[Read the docs →](https://mikeyobrien.github.io/autoloop/)**
```

In the "Further Reading" or equivalent section, replace or consolidate individual moved-doc links so the README does not depend on stale pre-migration paths. Keep the README self-contained for quick reference (install, quick start) but direct readers to the site for detailed docs.

### 4. Review landing page

- Verify hero section renders correctly
- Check that action buttons link to the right pages
- Confirm feature cards are accurate and link to the correct feature pages

### 5. Verify edit links

Click "Edit this page" on a few pages and confirm the GitHub edit URLs resolve correctly.

## Acceptance Criteria

- `vitepress build docs` reports zero dead links
- README contains a prominent link to the docs site
- README no longer depends on stale links to moved doc files
- Edit links on the site point to correct GitHub file paths
