#!/usr/bin/env bash
# Thin wrapper: runs the vitest suite that pins every pass-1 recommendation.
set -euo pipefail
cd "$(dirname "$0")/../../.."
exec npx vitest run test/integration/agent-surfaces-cli.test.ts
