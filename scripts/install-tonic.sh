#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
git_ref_file="$repo_dir/.tonic-git-ref"
version_file="$repo_dir/.tonic-version"
repo_url="${TONIC_GIT_URL:-https://github.com/mikeyobrien/tonic.git}"

if [[ -f "$git_ref_file" ]]; then
  git_ref="$(tr -d '[:space:]' < "$git_ref_file")"
  if [[ -n "$git_ref" ]]; then
    echo "install-tonic: installing tonic from git $repo_url @ $git_ref"
    cargo install --git "$repo_url" --rev "$git_ref" tonic --force
    exit 0
  fi
fi

if [[ -f "$version_file" ]]; then
  version="$(tr -d '[:space:]' < "$version_file")"
  if [[ -n "$version" ]]; then
    echo "install-tonic: .tonic-version=$version is informational only here; no crates.io install path is configured" >&2
  fi
fi

echo "install-tonic: missing .tonic-git-ref; this repo currently requires a git-pinned Tonic install" >&2
exit 1
