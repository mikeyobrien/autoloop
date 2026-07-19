#!/bin/sh
set -eu

# Manual/release-time check for compiled standalone binaries.
# This is intentionally not wired into Vitest: it creates a real git repo and
# drives the compiled binary through a deterministic two-iteration loop.

script_dir=$(CDPATH='' cd "$(dirname "$0")" && pwd)
repo_root=$(CDPATH='' cd "$script_dir/../.." && pwd)
fixture_dir="$script_dir/fixtures/routing-repro"

host_target() {
  case "$(uname -s)" in
    Darwin) host_os=darwin ;;
    Linux) host_os=linux ;;
    *)
      printf 'Unsupported host operating system: %s\n' "$(uname -s)" >&2
      exit 1
      ;;
  esac

  case "$(uname -m)" in
    arm64|aarch64) host_arch=arm64 ;;
    x86_64|amd64) host_arch=x64 ;;
    *)
      printf 'Unsupported host architecture: %s\n' "$(uname -m)" >&2
      exit 1
      ;;
  esac

  printf '%s-%s\n' "$host_os" "$host_arch"
}

binary=${AUTOLOOP_BIN:-"$repo_root/dist-bin/autoloop-$(host_target)"}
case "$binary" in
  /*) ;;
  *) binary="$repo_root/$binary" ;;
esac

if [ ! -x "$binary" ]; then
  printf 'Standalone binary is not executable: %s\n' "$binary" >&2
  printf 'Build it first with: sh scripts/build-standalone.sh --current\n' >&2
  exit 1
fi

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/autoloop-routing-repro.XXXXXX")
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT HUP INT TERM

repo="$work_dir/repo"
mkdir -p "$repo"
cp -R "$fixture_dir" "$repo/preset"

(
  cd "$repo"
  git init -q
  "$binary" run "$repo/preset" --no-worktree --no-default-profiles \
    --max-iterations 2 "Verify compiled-binary event routing" \
    >"$work_dir/run.log" 2>&1
) || {
  printf 'Standalone routing repro failed while running the loop:\n' >&2
  cat "$work_dir/run.log" >&2
  exit 1
}

journal="$repo/.autoloop/journal.jsonl"
if [ ! -f "$journal" ]; then
  journal=$(find "$repo/.autoloop/runs" -type f -name journal.jsonl -print 2>/dev/null | sed -n '1p')
fi
if [ -z "$journal" ] || [ ! -f "$journal" ]; then
  printf 'Standalone routing repro did not produce a run journal.\n' >&2
  cat "$work_dir/run.log" >&2
  exit 1
fi

iteration_two=$(grep -E '"iteration"[[:space:]]*:[[:space:]]*"2".*"topic"[[:space:]]*:[[:space:]]*"iteration.start"' "$journal" | sed -n '1p' || true)
if [ -z "$iteration_two" ]; then
  printf 'Standalone routing repro found no iteration 2 start record.\n' >&2
  cat "$journal" >&2
  exit 1
fi

expected_role=second
if ! printf '%s\n' "$iteration_two" | grep -Eq '"suggested_roles"[[:space:]]*:[[:space:]]*"'"$expected_role"'"'; then
  printf 'Iteration 2 was not routed to role %s. Record:\n%s\n' \
    "$expected_role" "$iteration_two" >&2
  exit 1
fi

printf 'PASS: standalone iteration 2 routed to role %s\n' "$expected_role"
