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

if [[ ! -f "$version_file" ]]; then
  echo "install-tonic: missing .tonic-version" >&2
  exit 1
fi

version="$(tr -d '[:space:]' < "$version_file")"
if [[ -z "$version" ]]; then
  echo "install-tonic: .tonic-version is empty" >&2
  exit 1
fi

echo "install-tonic: installing tonic-lang version $version"
cargo install tonic-lang --version "$version"
