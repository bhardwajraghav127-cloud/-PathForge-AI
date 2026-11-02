#!/usr/bin/env bash
# Native engine configure + build (Release, Ninja, FetchContent deps).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cmake --preset native-release -S "$ROOT/engine" 2>&1 | tail -n 3
cmake --build "$ROOT/engine/build/native-release" 2>&1 | tail -n 5
echo "NATIVE BUILD OK"
