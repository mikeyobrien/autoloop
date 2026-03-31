#!/usr/bin/env bash
set -euo pipefail

binary_path="${1:-}"
tag="${2:-}"
platform="${3:-}"
out_dir="${4:-}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_dir="$(cd "$script_dir/.." && pwd -P)"

if [[ -z "$binary_path" || -z "$tag" || -z "$platform" || -z "$out_dir" ]]; then
  echo "Usage: scripts/package-release.sh <binary-path> <tag> <platform> <output-dir>" >&2
  exit 1
fi

if [[ ! -f "$binary_path" ]]; then
  echo "error: binary not found: $binary_path" >&2
  exit 1
fi

archive_name="autoloops-${tag}-${platform}.tar.gz"
stage_root="$(mktemp -d)"
stage_dir="$stage_root/autoloops-${tag}-${platform}"
mkdir -p "$out_dir"
out_dir_abs="$(cd "$out_dir" && pwd -P)"
archive_path="$out_dir_abs/$archive_name"

cleanup() {
  rm -rf "$stage_root"
}
trap cleanup EXIT

mkdir -p "$stage_dir" "$out_dir"

# Write a shell-wrapper launcher that auto-sets AUTOLOOPS_BUNDLE_ROOT
# and invokes tonic directly so its arg routing works correctly.
cat > "$stage_dir/autoloops" <<'WRAPPER'
#!/bin/sh
# Launcher for autoloops. Invokes tonic directly with the bundle directory
# so tonic's own argument parsing routes 'run . <preset> <prompt>' correctly.
SCRIPT_PATH="$0"
case "$SCRIPT_PATH" in
  /*) ;;
  *) SCRIPT_PATH="$(pwd)/$SCRIPT_PATH" ;;
esac
while [ -L "$SCRIPT_PATH" ]; do
  LINK_TARGET="$(readlink "$SCRIPT_PATH")"
  case "$LINK_TARGET" in
    /*) SCRIPT_PATH="$LINK_TARGET" ;;
    *) SCRIPT_PATH="$(dirname "$SCRIPT_PATH")/$LINK_TARGET" ;;
  esac
done
BUNDLE_ROOT="$(cd "$(dirname "$SCRIPT_PATH")" && pwd -P)"
AUTOLOOPS_BUNDLE_ROOT="$BUNDLE_ROOT" exec tonic run "$BUNDLE_ROOT" "$@"
WRAPPER
chmod +x "$stage_dir/autoloops"

# Bundle presets, roles, and runtime source so the binary works standalone
cp -r "$repo_dir/presets" "$stage_dir/"
cp -r "$repo_dir/roles" "$stage_dir/"
cp -r "$repo_dir/src" "$stage_dir/"
cp "$repo_dir/tonic.toml" "$stage_dir/"
cp "$repo_dir/.tonic-version" "$stage_dir/"

# Copy compiled TIR artifacts needed for runtime self-hosting
mkdir -p "$stage_dir/.tonic/build"
for f in main.tnx.json main.tir.json miniloops-self; do
  if [[ -f "$repo_dir/.tonic/build/$f" ]]; then
    cp "$repo_dir/.tonic/build/$f" "$stage_dir/.tonic/build/"
  fi
done

cat > "$stage_dir/README.txt" <<EOF
autoloops ${tag} (${platform})

Install:
  chmod +x autoloops
  mv autoloops ~/.local/bin/autoloops

Then run:
  autoloops --help

EOF

(
  cd "$stage_root"
  tar -czf "$archive_path" "$(basename "$stage_dir")"
)

printf 'packaged release archive: %s\n' "$archive_path"
