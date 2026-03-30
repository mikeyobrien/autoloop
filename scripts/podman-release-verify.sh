#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image_tag="${1:-autoloops-release-verify:local}"

podman build \
  -f "$repo_root/scripts/podman-release-verify.Containerfile" \
  -t "$image_tag" \
  "$repo_root"

podman run --rm \
  -v "$repo_root":/work:Z \
  "$image_tag" \
  /bin/bash /work/scripts/podman-release-verify-runtime.sh
