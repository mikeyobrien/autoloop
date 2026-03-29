#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out_path="${1:-}"
log_file="$(mktemp)"

if [[ -z "$out_path" ]]; then
  echo "Usage: scripts/build-release.sh <output-path>" >&2
  exit 1
fi

cleanup() {
  rm -f "$log_file"
}
trap cleanup EXIT

mkdir -p "$(dirname "$out_path")"

if tonic compile "$repo_dir" --out "$out_path" >"$log_file" 2>&1; then
  cat "$log_file"
  chmod +x "$out_path"
  printf 'built release binary: %s\n' "$out_path"
  exit 0
fi

cat "$log_file" >&2
exit 1
