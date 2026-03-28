#!/usr/bin/env bash
set -euo pipefail

binary_path="${1:-}"
tag="${2:-}"
platform="${3:-}"
out_dir="${4:-}"

if [[ -z "$binary_path" || -z "$tag" || -z "$platform" || -z "$out_dir" ]]; then
  echo "Usage: scripts/package-release.sh <binary-path> <tag> <platform> <output-dir>" >&2
  exit 1
fi

if [[ ! -f "$binary_path" ]]; then
  echo "error: binary not found: $binary_path" >&2
  exit 1
fi

archive_name="miniloops-${tag}-${platform}.tar.gz"
stage_root="$(mktemp -d)"
stage_dir="$stage_root/miniloops-${tag}-${platform}"
archive_path="$out_dir/$archive_name"

cleanup() {
  rm -rf "$stage_root"
}
trap cleanup EXIT

mkdir -p "$stage_dir" "$out_dir"
cp "$binary_path" "$stage_dir/miniloops"
chmod +x "$stage_dir/miniloops"
cat > "$stage_dir/README.txt" <<EOF
miniloops ${tag} (${platform})

Install:
  chmod +x miniloops
  mv miniloops ~/.local/bin/miniloops

Then run:
  miniloops --help
EOF

(
  cd "$stage_root"
  tar -czf "$archive_path" "$(basename "$stage_dir")"
)

printf 'packaged release archive: %s\n' "$archive_path"
