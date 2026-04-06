#!/bin/bash
exec kiro-cli chat --trust-all-tools --agent gpu-dev --no-interactive "$@"
