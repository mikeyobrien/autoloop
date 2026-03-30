#!/usr/bin/env bash
set -euo pipefail

REPO="${AUTOLOOPS_REPO:-mikeyobrien/autoloop}"
VERSION="${AUTOLOOPS_VERSION:-latest}"
INSTALL_DIR="${INSTALL_DIR:-${AUTOLOOPS_INSTALL_DIR:-$HOME/.local/bin}}"
PLATFORM_OVERRIDE="${AUTOLOOPS_PLATFORM:-}"
RELEASES_BASE_URL="${AUTOLOOPS_RELEASES_BASE_URL:-}"

usage() {
  cat <<'EOF'
Usage: install.sh [--version <tag>] [--dir <install-dir>]

Installs the autoloops binary from GitHub Releases.

Environment overrides:
  AUTOLOOPS_VERSION            Release tag to install (default: latest)
  AUTOLOOPS_INSTALL_DIR        Install directory (default: ~/.local/bin)
  AUTOLOOPS_PLATFORM           Override detected platform (e.g. linux-x64)
  AUTOLOOPS_RELEASES_BASE_URL  Override release base URL for testing/mirrors
  AUTOLOOPS_REPO               GitHub repo slug (default: mikeyobrien/autoloop)
EOF
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: required command not found: $1" >&2
    exit 1
  }
}

shell_has() {
  command -v "$1" >/dev/null 2>&1
}

detect_platform() {
  if [[ -n "$PLATFORM_OVERRIDE" ]]; then
    printf '%s\n' "$PLATFORM_OVERRIDE"
    return
  fi

  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os/$arch" in
    Darwin/arm64)
      echo "macos-arm64"
      ;;
    Linux/x86_64|Linux/amd64)
      echo "linux-x64"
      ;;
    *)
      echo "error: unsupported platform $os/$arch" >&2
      exit 1
      ;;
  esac
}

resolve_latest_version() {
  local latest_url effective
  latest_url="https://github.com/${REPO}/releases/latest"
  effective="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$latest_url")"
  basename "$effective"
}

resolve_version() {
  if [[ "$VERSION" != "latest" ]]; then
    printf '%s\n' "$VERSION"
    return
  fi

  if [[ -n "$RELEASES_BASE_URL" ]]; then
    echo "error: AUTOLOOPS_RELEASES_BASE_URL requires AUTOLOOPS_VERSION to be set explicitly" >&2
    exit 1
  fi

  resolve_latest_version
}

release_base_url() {
  if [[ -n "$RELEASES_BASE_URL" ]]; then
    printf '%s\n' "$RELEASES_BASE_URL"
  else
    printf 'https://github.com/%s/releases/download/%s\n' "$REPO" "$1"
  fi
}

download() {
  local url out
  url="$1"
  out="$2"
  curl -fsSL "$url" -o "$out"
}

verify_checksum() {
  local asset_name asset_path checksum_path expected line actual
  asset_name="$1"
  asset_path="$2"
  checksum_path="$3"

  [[ -f "$checksum_path" ]] || return 0

  line="$(grep "  ${asset_name}$" "$checksum_path" || true)"
  if [[ -z "$line" ]]; then
    echo "warning: checksum entry for ${asset_name} not found; skipping verification" >&2
    return 0
  fi

  expected="${line%% *}"

  if shell_has sha256sum; then
    actual="$(sha256sum "$asset_path" | awk '{print $1}')"
  elif shell_has shasum; then
    actual="$(shasum -a 256 "$asset_path" | awk '{print $1}')"
  else
    echo "warning: sha256sum/shasum not found; skipping verification" >&2
    return 0
  fi

  if [[ "$actual" != "$expected" ]]; then
    echo "error: checksum verification failed for ${asset_name}" >&2
    echo "expected: $expected" >&2
    echo "actual:   $actual" >&2
    exit 1
  fi
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version)
        VERSION="${2:-}"
        shift 2
        ;;
      --dir)
        INSTALL_DIR="${2:-}"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "error: unknown argument: $1" >&2
        usage >&2
        exit 1
        ;;
    esac
  done

  need_cmd curl
  need_cmd tar
  need_cmd mktemp

  local version platform base_url asset_name checksum_name tmp_dir archive_path checksum_path extracted_dir binary_path
  version="$(resolve_version)"
  platform="$(detect_platform)"
  base_url="$(release_base_url "$version")"
  asset_name="autoloops-${version}-${platform}.tar.gz"
  checksum_name="SHA256SUMS.txt"

  tmp_dir="$(mktemp -d)"
  trap "rm -rf '$tmp_dir'" EXIT

  archive_path="$tmp_dir/$asset_name"
  checksum_path="$tmp_dir/$checksum_name"

  echo "==> Downloading ${asset_name}"
  download "${base_url}/${asset_name}" "$archive_path"

  if download "${base_url}/${checksum_name}" "$checksum_path"; then
    verify_checksum "$asset_name" "$archive_path" "$checksum_path"
  else
    echo "warning: could not download ${checksum_name}; continuing without checksum verification" >&2
  fi

  echo "==> Extracting archive"
  tar -xzf "$archive_path" -C "$tmp_dir"

  extracted_dir="$tmp_dir/autoloops-${version}-${platform}"
  binary_path="$extracted_dir/autoloops"
  if [[ ! -f "$binary_path" ]]; then
    echo "error: extracted archive did not contain autoloops binary at $binary_path" >&2
    exit 1
  fi

  mkdir -p "$INSTALL_DIR"
  install -m 755 "$binary_path" "$INSTALL_DIR/autoloops"

  echo "installed autoloops to $INSTALL_DIR/autoloops"
  if ! command -v autoloops >/dev/null 2>&1; then
    case ":$PATH:" in
      *":$INSTALL_DIR:"*) ;;
      *)
        echo "note: $INSTALL_DIR is not on your PATH"
        echo "      add this to your shell profile: export PATH=\"$INSTALL_DIR:\$PATH\""
        ;;
    esac
  fi

  "$INSTALL_DIR/autoloops" --help >/dev/null 2>&1 || true
}

main "$@"
