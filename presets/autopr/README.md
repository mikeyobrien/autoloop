# AutoPR miniloop

Use when you want to turn the current branch into an accurate, reviewable pull request.

AutoPR inspects repo and branch state, normalizes any structured PR request, drafts a reviewer-useful title/body, validates that the draft matches the actual diff and evidence, and then creates or updates the PR. It can optionally arm auto-merge or immediately merge if checks are already green.

Shape:
- collector — resolves the request, repo state, base/head branches, checks, and existing PR state
- drafter — writes the PR title/body/checklist
- validator — attacks mismatches, fake claims, weak reviewer guidance, and missing evidence
- publisher — creates or updates the PR and optionally arms/executes merge behavior

## Fail-closed contract

AutoPR is not a PR-hallucination preset.

- A PR draft must match the real diff and real verification evidence.
- Missing checks, ambiguous branch state, missing `gh` auth, or unknown mergeability should block publication instead of being papered over.
- `publish-and-arm` should enable auto-merge and stop; it should not poll CI.
- `publish-and-merge-if-green` should merge only when green *now* or otherwise arm auto-merge if supported.

## Remote-first base comparison

AutoPR always compares the PR branch against `origin/<base>` (the remote tracking ref), not the local `<base>` ref. This prevents a dangerous class of bugs where local main is ahead of or diverged from origin/main:

- **Merge-base, commit list, and file diff** are all computed against `origin/<base>`. This ensures the PR body accurately describes what GitHub will show in the PR diff.
- **Inherited unpublished commit guard**: If the head branch includes commits that exist on local `<base>` but not on `origin/<base>`, these would silently appear in the GitHub PR. AutoPR detects this and blocks publication (`pr.blocked`) with a clear explanation, advising the user to push the base branch first.
- **Local/remote divergence disclosure**: When local `<base>` differs from `origin/<base>` (even without inherited commits leaking into the head branch), the collector records the divergence status in `pr-context.md` so the drafter and validator are aware.

The validator independently recomputes the diff against `origin/<base>` and rejects drafts whose scope doesn't match the remote-based diff.

## How it works

1. **Collector** reads the launch prompt, optional `.autoloop/pr-request.md`, git state, and GitHub state and writes `.autoloop/pr-context.md`.
2. **Drafter** writes `.autoloop/pr-draft.md` with title, body, verification, risks, and reviewer focus.
3. **Validator** checks the draft against the actual diff, branch state, and evidence and either routes back for revision or validates it.
4. **Publisher** creates or updates the PR and records the result in `.autoloop/pr-result.md`.

## Inputs

### Primary input

Run it with a normal objective prompt:

```bash
autoloop run autopr "Open a PR for the current branch against main and enable auto-merge if checks pass."
```

### Optional structured request

If `.autoloop/pr-request.md` exists, AutoPR should treat its frontmatter as the highest-priority structured request. Recommended fields:

```md
---
base: main
mode: publish-and-arm
draft: false
reviewers:
  - alice
  - bob
labels:
  - dashboard
  - ux
issue: 123
rfc: docs/rfcs/dashboard-event-rendering.md
title_hint: Improve dashboard event rendering and prompt display
---

Open a PR for the dashboard UI work.
Call out that tests passed and that this is UI-only.
```

Supported frontmatter fields:
- `base`
- `mode` (`publish`, `publish-and-arm`, `publish-and-merge-if-green`)
- `draft`
- `reviewers`
- `labels`
- `issue`
- `rfc`
- `title_hint`

## Files

- `autoloops.toml` — loop + backend config
- `topology.toml` — role deck + handoff graph
- `harness.md` — shared harness rules loaded every iteration
- `roles/collector.md`
- `roles/drafter.md`
- `roles/validator.md`
- `roles/publisher.md`

## Shared working files created by the loop

- `.autoloop/pr-request.md` — optional structured request with frontmatter
- `.autoloop/pr-context.md` — normalized publish context and repo evidence
- `.autoloop/pr-draft.md` — title/body/checklist draft
- `.autoloop/pr-result.md` — final PR URL/number and publish disposition
- `.autoloop/progress.md` — phase, blockers, and verification notes
