# GitHub Actions

This repo does **not** run pull-request CI on GitHub-hosted runners.

Merge proof is local: run the gates in [`docs/ci-local.md`](../../docs/ci-local.md), then `gh signoff` (status context `signoff`).

Kept (publish / deploy only):

- [`docs.yml`](docs.yml) — VitePress → GitHub Pages on `main`
- [`publish-npm.yml`](publish-npm.yml) — npm publish + GitHub release + binaries on `v*` tags

Do not add a PR `ci.yml` back. The Actions UI may still list a leftover **Release** workflow (`release.yml`); that file is gone and is superseded by `publish-npm.yml`.
