#!/usr/bin/env bash
# Run native GoogleTest suite via ctest.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ctest --test-dir "$ROOT/engine/build/native-release" --output-on-failure 2>&1 | tail -n 15
