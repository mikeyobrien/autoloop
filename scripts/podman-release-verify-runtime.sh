#!/usr/bin/env bash
set -euo pipefail

source "$HOME/.cargo/env"

export CARGO_BUILD_JOBS=1
export CARGO_PROFILE_RELEASE_LTO=off
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16

cd /work

tonic --help >/dev/null
rustc --version
cargo --version

tonic check .
./bin/test test/release_install_test.tn

rm -rf dist/release
mkdir -p dist/release
scripts/build-release.sh dist/autoloops
scripts/package-release.sh dist/autoloops v9.9.9-test linux-x64 dist/release
(
  cd dist/release
  sha256sum autoloops-v9.9.9-test-linux-x64.tar.gz > SHA256SUMS.txt
)

INSTALL_DIR=/tmp/autoloops-bin \
AUTOLOOPS_VERSION=v9.9.9-test \
AUTOLOOPS_PLATFORM=linux-x64 \
AUTOLOOPS_RELEASES_BASE_URL=file:///work/dist/release \
bash /work/install.sh

/tmp/autoloops-bin/autoloops --help
/work/scripts/release-smoke.sh dist/autoloops

echo "podman release verify: ok"
