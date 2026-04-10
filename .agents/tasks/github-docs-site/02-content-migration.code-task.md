# Task 2: Content Migration

**RFC:** `docs/rfcs/github-docs-site.md`
**Files to create:** `docs/getting-started/installation.md`, `docs/getting-started/quick-start.md`
**Files to move:** 18 existing public docs into subdirectories
**Files to modify:** All moved docs (cross-reference link updates)
**Estimated scope:** ~50 lines new content, ~30 link rewrites

## Objective

Reorganize the 18 public docs into the IA subdirectory structure, extract Getting Started pages from the README, rename legacy files, fix all cross-reference links, and update repo-facing inbound links that would otherwise go stale.

## Prerequisites

- Task 1 complete (VitePress config with sidebar referencing the new paths)

## Steps

### 1. Create subdirectories

```bash
mkdir -p docs/{getting-started,guides,features,reference,concepts,development}
```

### 2. Move docs into subdirectories

```bash
# Guides
mv docs/creating-presets.md docs/guides/
mv docs/auto-workflows.md docs/guides/
mv docs/miniloops-wt-operating-playbook.md docs/guides/operating-playbook.md  # rename

# Features
mv docs/worktree.md docs/features/
mv docs/dynamic-chains.md docs/features/
mv docs/dashboard.md docs/features/
mv docs/profiles.md docs/features/
mv docs/tasks.md docs/features/
mv docs/llm-judge.md docs/features/
mv docs/operator-health.md docs/features/

# Reference
mv docs/cli.md docs/reference/
mv docs/configuration.md docs/reference/
mv docs/topology.md docs/reference/
mv docs/memory.md docs/reference/
mv docs/journal.md docs/reference/
mv docs/metareview.md docs/reference/

# Concepts
mv docs/platform.md docs/concepts/

# Development
mv docs/releasing.md docs/development/
```

### 3. Extract Getting Started pages from README

**`docs/getting-started/installation.md`**: Extract the installation section from README (npm/npx install instructions, prerequisites, environment variables). Add a `# Installation` heading.

**`docs/getting-started/quick-start.md`**: Extract the quick start / usage section from README (first loop example, `autoloop run` command, basic config). Add a `# Quick Start` heading.

### 4. Rewrite cross-reference links inside moved docs

Scan all moved docs for relative markdown links and update paths. Common patterns:

| Old link | New link (from file's new location) |
|----------|-------------------------------------|
| `[Platform](platform.md)` in `topology.md` | `[Platform](../concepts/platform.md)` |
| `[CLI](cli.md)` in `configuration.md` | `[CLI](cli.md)` (same directory, no change) |
| `[Configuration](configuration.md)` in guides | `[Configuration](../reference/configuration.md)` |
| `[Memory](memory.md)` in features | `[Memory](../reference/memory.md)` |

**Approach**: For each moved file, grep for `](` patterns, identify relative links, and update paths based on the file's new location relative to the target's new location.

### 5. Audit inbound repo links to moved docs

At minimum, update `README.md` references that still point at old `docs/*.md` paths after the move. This includes:
- inline README references such as `docs/creating-presets.md` and `docs/cli.md#mock-backend`
- the README "Further Reading" list

For excluded markdown content under `docs/rfcs/` and `docs/plans/`, either:
- leave historical references in place and explicitly accept them as non-public/internal, or
- update them if they are meant to stay actively maintained

Record whichever choice you make in the implementation PR notes.

### 6. Copy hero image for the site

```bash
mkdir -p docs/public
cp docs/launches/autoloop-readme-hero.png docs/public/hero.png
```

### 7. Confirm excluded internal docs remain excluded

Do NOT move `archive-active-context-2026-03-27.md`, `docs/rfcs/`, `docs/plans/`, `docs/reports/`, or `docs/launches/`. They should remain outside the public site and already be covered by Task 1's `srcExclude`.

Verify the config still includes those excludes after the content move.

### 8. Verify

```bash
npx vitepress build docs
# Should exit 0 with no broken link warnings
npx vitepress dev docs
# All sidebar links should resolve to real pages
```

Also spot-check README links that referenced moved docs to confirm they no longer point at stale paths.

## Acceptance Criteria

- All 18 public docs are in their correct subdirectories per the IA
- `getting-started/installation.md` and `getting-started/quick-start.md` exist with extracted README content
- No broken cross-reference links (VitePress build reports these)
- `miniloops-wt-operating-playbook.md` renamed to `guides/operating-playbook.md`
- README links to moved docs have been updated or intentionally consolidated to the docs site
- Internal docs (rfcs, plans, reports, launches, archive docs) remain excluded via `srcExclude`
- Hero image available at `docs/public/hero.png`
