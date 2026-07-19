#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/build-standalone.sh [--current | --target <target>]

Build standalone autoloop binaries with Bun.

Options:
  --current          Build for the current host platform
  --target <target>  Build one target (darwin-arm64, darwin-x64,
                     linux-arm64, linux-x64; optional bun- prefix)
  --help             Show this help

With no options, all four supported targets are built.
EOF
}

fail_usage() {
  printf 'Error: %s\n\n' "$1" >&2
  usage >&2
  exit 1
}

normalize_target() {
  target=${1#bun-}
  case "$target" in
    darwin-arm64|darwin-x64|linux-arm64|linux-x64)
      printf '%s\n' "$target"
      ;;
    *)
      fail_usage "unsupported target: $1"
      ;;
  esac
}

if [ "$#" -eq 0 ]; then
  targets='darwin-arm64 darwin-x64 linux-x64 linux-arm64'
else
  case "$1" in
    --help)
      [ "$#" -eq 1 ] || fail_usage "--help does not accept arguments"
      usage
      exit 0
      ;;
    --current)
      [ "$#" -eq 1 ] || fail_usage "--current does not accept arguments"
      case "$(uname -s)" in
        Darwin) target_os=darwin ;;
        Linux) target_os=linux ;;
        *) fail_usage "unsupported host operating system: $(uname -s)" ;;
      esac
      case "$(uname -m)" in
        arm64|aarch64) target_arch=arm64 ;;
        x86_64|amd64) target_arch=x64 ;;
        *) fail_usage "unsupported host architecture: $(uname -m)" ;;
      esac
      targets="$target_os-$target_arch"
      ;;
    --target)
      [ "$#" -eq 2 ] || fail_usage "--target requires exactly one target"
      targets=$(normalize_target "$2")
      ;;
    *)
      fail_usage "unknown option: $1"
      ;;
  esac
fi

if command -v bun >/dev/null 2>&1; then
  BUN=$(command -v bun)
elif [ -x "${HOME:-}/.bun/bin/bun" ]; then
  BUN=${HOME}/.bun/bin/bun
else
  cat >&2 <<'EOF'
Error: Bun is required to build standalone binaries but was not found.
Install Bun with:
  curl -fsSL https://bun.sh/install | bash
See https://bun.sh/docs/installation for other installation methods.
EOF
  exit 1
fi

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd "$script_dir/.." && pwd)
cd "$repo_root"

npm run build
VERSION=$(node -p "require('./packages/cli/package.json').version")
mkdir -p dist-bin

for target in $targets; do
  output="dist-bin/autoloop-$target"
  printf 'Building %s...\n' "$output"
  "$BUN" build --compile packages/cli/dist/main.js \
    "--target=bun-$target" \
    --define "process.env.AUTOLOOP_BUILD_VERSION=\"$VERSION\"" \
    --outfile "$output"
  printf 'Built %s\n' "$output"
done
