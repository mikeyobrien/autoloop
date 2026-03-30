# Task: Build And Publish Release Binaries Through GitHub Actions

## Description
Add a tag-driven GitHub Actions release pipeline that validates the tagged commit, compiles standalone `autoloops` binaries, smoke-tests the compiled artifact, packages platform archives plus checksums, and publishes them to GitHub Releases. Keep the first pass narrow, inspectable, and repo-owned.

## Background
The repo now has source CI but no binary release path.

Current state:
- `.github/workflows/ci.yml` validates source with `tonic check .` and `bin/test`
- `.tonic-version` pins the Tonic toolchain version for CI
- `src/main.tn` already uses `tonic compile ... --out ...` for self-compilation fallback
- `bin/autoloops` is still a source-install launcher, not a shipped compiled artifact
- `README.md` documents source installation, not release-binary installation

That means there is still no single command path from “tag this commit” to “downloadable release assets exist for end users.”

## Reference Documentation
**Required:**
- Design: `docs/rfcs/github-actions-binary-release-pipeline.md`
- Workflow: `.github/workflows/ci.yml`
- Toolchain pin: `.tonic-version`
- CLI wrapper: `bin/autoloops`
- Source: `src/main.tn` (self-compilation path around `compiled_self_command`)
- Docs: `README.md`
- Docs: `docs/cli.md`
- Existing CI smoke reference: `scripts/pi-smoke.sh`

## Technical Requirements

### Slice 1 — Define the release artifact contract
1. Add a dedicated release workflow at `.github/workflows/release.yml`.
2. Trigger it on pushed tags matching `v*`.
3. Optionally support `workflow_dispatch` for manual rebuilds/dry-runs without making dispatch the primary release contract.
4. Use the git tag as the release version source of truth; do not add version-bump commits or a separate release metadata file in this slice.
5. Keep the distributed binary name `autoloops`.
6. Start with a narrow supported platform matrix:
   - `linux-x64`
   - `macos-arm64`
7. Produce deterministic archive names:
   - `autoloops-<tag>-linux-x64.tar.gz`
   - `autoloops-<tag>-macos-arm64.tar.gz`
   - `SHA256SUMS.txt`

### Slice 2 — Add repo-owned build, packaging, and smoke helpers
8. Add a small build helper script (for example `scripts/build-release.sh`) that:
   - installs no extra dependencies
   - invokes `tonic compile . --out <path>`
   - marks the result executable
9. Add a small packaging helper script (for example `scripts/package-release.sh`) that:
   - stages the compiled binary under the canonical name `autoloops`
   - creates the release archive with the canonical asset filename
   - keeps packaging logic out of large inline YAML blocks
10. Add a compiled-binary smoke script (for example `scripts/release-smoke.sh`) that validates the shipped artifact without depending on Pi/network access.
11. The smoke path must use a tiny temp fixture with a `command` backend and verify at minimum:
   - the compiled binary runs
   - `autoloops --help` works
   - a tiny loop run completes
   - expected runtime artifacts/output can be inspected
12. Do not make the release workflow depend on Pi-backed smoke or external credentials.

### Slice 3 — Implement release workflow jobs
13. Add a `verify` job that runs before packaging and re-runs release-critical validation:
   - checkout
   - install Tonic from `.tonic-version`
   - `tonic check .`
   - `./bin/test`
14. Add a matrix `build` job for the supported platforms that:
   - installs the pinned Tonic version
   - builds the compiled binary via the helper script
   - smoke-tests the compiled artifact via the helper script
   - packages the release archive
   - uploads per-platform artifacts to the workflow run
15. Add a `publish` job that:
   - downloads packaged artifacts
   - generates `SHA256SUMS.txt`
   - creates or updates the GitHub Release for the tag
   - uploads archives and checksums to the release
16. Use `GITHUB_TOKEN` with explicit `contents: write` permission.
17. Prefer explicit shell + `gh release create` / `gh release upload` over adding a third-party release action unless a concrete GitHub CLI blocker appears.
18. Fail closed if any expected archive, checksum, or smoke check result is missing.

### Slice 4 — Docs and release operator UX
19. Update `README.md` with an install-from-release section.
20. Keep the existing source-install path documented, but make the binary-release path clear for end users who do not want a source checkout.
21. Update `docs/cli.md` so it is clear the public CLI may come from either:
   - the compiled release binary
   - the source wrapper `bin/autoloops`
22. If needed for clarity, add a short `docs/releasing.md` operator guide covering:
   - create annotated tag
   - push tag
   - inspect release workflow
   - verify assets/checksums

### Cross-cutting requirements
23. Keep the implementation narrow: release assets only, no package-manager publishing in this workstream.
24. Do not add Windows packaging in the first pass.
25. Do not infer versions from branch names, changelog files, or generated metadata; use the git tag.
26. Keep packaging/install paths inspectable through plain shell scripts and workflow YAML.
27. Validate the implementation with both source tests and compiled-binary smoke, not one or the other.

## Dependencies
- Existing source CI in `.github/workflows/ci.yml`
- Tonic toolchain pin in `.tonic-version`
- Self-compilation precedent in `src/main.tn`
- Public CLI wrapper in `bin/autoloops`
- Current install docs in `README.md` and `docs/cli.md`
- GitHub-hosted runners and repo release permissions

## Implementation Approach

### 1. Land the release contract first
Define the tag pattern, supported platforms, asset names, and publish job behavior before writing helper scripts so packaging and docs all speak the same language.

### 2. Keep scripts small and purpose-specific
Prefer a few short scripts over a large opaque workflow:
- `build-release.sh`
- `package-release.sh`
- `release-smoke.sh`

Each script should do one thing well and be runnable locally where practical.

### 3. Validate the compiled artifact, not just source
The distinguishing requirement of this task is shipped-binary confidence. The smoke check should exercise the compiled binary directly and avoid dependencies on Pi credentials or hosted-model availability.

### 4. Separate release workflow from normal CI
Do not overload `ci.yml`. Keep source CI and tag publication distinct so the release path is easy to inspect and rerun.

### 5. Update docs with the code
Release assets without install docs are half-finished. Land README/CLI/release operator docs in the same workstream.

## Acceptance Criteria
1. A pushed tag matching `v*` starts `.github/workflows/release.yml`.
2. The release workflow re-runs `tonic check .` and `./bin/test` before packaging.
3. The workflow builds standalone binaries for `linux-x64` and `macos-arm64`.
4. Each built artifact is smoke-tested using the compiled binary itself and a local command-backend fixture.
5. The workflow publishes these assets to the GitHub Release for the tag:
   - `autoloops-<tag>-linux-x64.tar.gz`
   - `autoloops-<tag>-macos-arm64.tar.gz`
   - `SHA256SUMS.txt`
6. Checksums in `SHA256SUMS.txt` match the uploaded archives.
7. The workflow fails if a platform build, smoke test, packaging step, or release upload fails.
8. `README.md` documents install-from-release usage.
9. `docs/cli.md` reflects both source-wrapper and compiled-binary invocation paths.
10. The implementation does not require Pi credentials to publish a release.
11. The repo remains green under normal validation after the release changes land.

## Metadata
- **Complexity**: Medium
- **Labels**: releases, github-actions, ci-cd, binary-distribution, packaging, documentation
- **Required Skills**: GitHub Actions, shell scripting, release engineering, packaging, Tonic app development, documentation maintenance
