# Releasing

Binary releases are published by GitHub Actions from annotated tags.

## Release flow

1. Make sure `main` is green.
2. Create an annotated semver tag:

```bash
git tag -a v0.1.0 -m "v0.1.0"
```

3. Push the tag:

```bash
git push origin v0.1.0
```

4. Watch `.github/workflows/release.yml`.
5. Verify the GitHub Release contains:
   - `autoloops-v0.1.0-linux-x64.tar.gz`
   - `autoloops-v0.1.0-macos-arm64.tar.gz`
   - `SHA256SUMS.txt`

## What the workflow does

- installs Tonic via `scripts/install-tonic.sh`
  - this repo currently pins Tonic by git commit in `.tonic-git-ref`
  - `.tonic-version` is informational here, not the active install source
- re-runs `tonic check .`
- re-runs `./bin/test`
- compiles standalone `autoloops` binaries
- smoke-tests the compiled binary with a real run-path check via `scripts/compiled-run-check.sh`
- packages release archives
- publishes the archives and checksums to GitHub Releases

## Install from a release archive

```bash
tar -xzf autoloops-v0.1.0-linux-x64.tar.gz
chmod +x autoloops-v0.1.0-linux-x64/autoloops
mv autoloops-v0.1.0-linux-x64/autoloops ~/.local/bin/autoloops
autoloops --help
```

The release binary does not require a source checkout for normal CLI use.
