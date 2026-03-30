# GitHub Actions Binary Release Pipeline

## Summary
Add a tag-driven GitHub Actions release pipeline that validates the tagged commit, compiles a standalone `autoloops` binary on supported runner platforms, smoke-tests the compiled artifact without requiring `tonic` at runtime, packages release archives plus checksums, and publishes them to GitHub Releases.

Code task: `.agents/tasks/tonic-loops/github-actions-binary-release-pipeline.code-task.md`

## Problem
Today the repo has CI for source validation, but no release path for shipping a compiled binary.

That leaves three gaps:
- operators must install Tonic and run the repo through `tonic run` or the shell wrapper
- there is no durable, repeatable way to turn a tagged commit into downloadable release artifacts
- release creation is manual and under-specified, so it is easy for docs, version tags, asset names, and validation to drift

The repo already contains the pieces needed for a releaseable binary:
- `.tonic-version` pins the toolchain
- `src/main.tn` already uses `tonic compile ... --out ...` for self-compilation paths
- `bin/autoloops` defines the public CLI name and current source-install UX
- `.github/workflows/ci.yml` already proves GitHub Actions is part of the toolchain story

What is missing is one explicit release contract and one workflow that turns tags into release assets.

## Goals
- Build standalone `autoloops` binaries in GitHub Actions from tagged commits.
- Publish binary archives and checksums to GitHub Releases.
- Validate the compiled binary itself, not just the source tree.
- Keep the release process tag-first and inspectable.
- Update docs so users can install from release assets without needing a source checkout.

## Non-goals
- Publishing to package managers (`npm`, Homebrew, apt, etc.) in this workstream.
- Adding Windows support in the first pass.
- Building a generalized release orchestration framework.
- Replacing the existing source-based `bin/autoloops` development workflow.
- Making Pi-backed smoke tests a hard blocker for release publication when they depend on external credentials/runtime setup.

## Proposed Design

### 1. Release contract
Use annotated semver tags as the release trigger.

Proposed trigger contract:
- tag pattern: `v*`
- source of truth for release version: the git tag itself
- release title: the tag name (for example `v0.1.0`)
- release notes: generated from GitHub’s built-in release notes, optionally prefixed with a short repo-authored note block

Start with a narrow platform matrix that matches current likely usage and GitHub-hosted runner reality:
- `linux-x64` via `ubuntu-latest`
- `macos-arm64` via `macos-14`

Possible later expansion:
- `macos-x64`
- `linux-arm64`

Keep the binary name `autoloops` even if the GitHub repo is named differently. The CLI/docs already speak in terms of `autoloops`; renaming the distributed binary would create unnecessary churn.

### 2. Release artifact layout
Each release should publish:
- `autoloops-<tag>-linux-x64.tar.gz`
- `autoloops-<tag>-macos-arm64.tar.gz`
- `SHA256SUMS.txt`

Each archive should contain:
- the compiled `autoloops` binary
- a small README/install note or copied top-level docs excerpt if useful
- license file if/when the repo adds one

Archive naming should be deterministic and human-readable so docs can reference it directly.

### 3. Build and packaging helpers
Add small repo-owned shell helpers so the workflow stays readable and the packaging logic is testable outside YAML glue.

Proposed scripts:
- `scripts/build-release.sh`
  - reads the target output path/platform inputs
  - runs `tonic compile . --out <path>`
  - marks the binary executable
- `scripts/package-release.sh`
  - creates a staging directory
  - copies the binary and minimal release docs
  - writes `tar.gz` archive with the canonical asset name
- `scripts/release-smoke.sh`
  - runs the compiled binary against a tiny temp fixture using a `command` backend
  - verifies at minimum:
    - `autoloops --help` works
    - a one-iteration loop can complete
    - projected output/journal artifacts are produced

The smoke test should avoid Pi/network dependencies. The point is to validate the shipped binary artifact, not the hosted-model environment.

### 4. Release workflow
Add a dedicated `.github/workflows/release.yml`.

Proposed triggers:
- `push` on tags matching `v*`
- optional `workflow_dispatch` for dry-runs or rebuilds of an existing tag/ref

Proposed job shape:

#### Job A — `verify`
Run on one Linux runner before any packaging:
- checkout
- read `.tonic-version`
- install pinned Tonic
- run `tonic check .`
- run `./bin/test`

This job should re-run release-critical validation rather than assuming branch CI already passed.

#### Job B — `build`
Matrix over supported platforms, needs `verify`:
- checkout
- install pinned Tonic
- compile the binary with `scripts/build-release.sh`
- smoke-test the compiled binary with `scripts/release-smoke.sh`
- package the archive with `scripts/package-release.sh`
- upload per-platform artifacts to the workflow run

#### Job C — `publish`
Needs all `build` matrix jobs:
- download packaged artifacts
- generate `SHA256SUMS.txt`
- create or update the GitHub Release for the tag
- upload archives + checksums

Use the repo `GITHUB_TOKEN` with `contents: write` permissions. Prefer plain `gh release create` / `gh release upload` commands over an additional third-party action so the release step stays explicit and inspectable.

### 5. Docs and operator UX
Update docs with the release path in the same workstream.

Minimum doc changes:
- `README.md`
  - add an install-from-release section
  - keep the existing source-install path, but make the release binary the shortest path for end users
- `docs/cli.md`
  - note that the public CLI can come either from the compiled release binary or from `bin/autoloops`
- optional `docs/releasing.md`
  - one short operator runbook: create tag, push tag, inspect workflow, verify release assets

### 6. Guardrails and boundaries
- Release publication must depend on compiled-binary smoke passing.
- Pi-backed smoke stays in normal CI/mainline validation and is not required for release publication unless the repo later gains a stable credentialed CI path for it.
- The release workflow should fail closed on missing assets or checksum generation problems.
- The workflow should not mutate source files, create version commits, or infer versions from anything other than the pushed tag.

## Alternatives Considered

### Trigger on GitHub Release creation instead of tags
Rejected for the first pass. Tags are a better git-native source of truth, easier to audit locally, and simpler to reproduce.

### Publish binaries from the existing `ci.yml`
Rejected. CI and release concerns are different enough that overloading one workflow would make the release path harder to reason about.

### Add package-manager publishing now
Rejected. Binary release assets are the narrow core. Package-manager distribution can layer on later once the binary contract is stable.

### Make Pi-smoke a release blocker
Rejected for now. It couples artifact publication to external runtime assumptions that are not required to prove the compiled binary works.

## Open Questions
- Do we want to support `macos-x64` in the first release pass, or keep the initial matrix to just Linux x64 + macOS arm64?
- Do we want an explicit `docs/releasing.md`, or is README + workflow comments enough?
- Should manual `workflow_dispatch` support building prerelease assets for non-tag refs, or only rebuilding an already-tagged ref?

## Implementation Notes
- Code task: `.agents/tasks/tonic-loops/github-actions-binary-release-pipeline.code-task.md`
- Ground the implementation in `.github/workflows/ci.yml`, `.tonic-version`, `README.md`, `docs/cli.md`, `bin/autoloops`, and the self-compilation path in `src/main.tn`.
- Prefer a small number of repo-owned scripts over large inline YAML shell blocks.
