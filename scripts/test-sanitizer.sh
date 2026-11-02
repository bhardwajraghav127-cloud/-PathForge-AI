#!/usr/bin/env bash
# Native sanitizer build + tests (ASan/UBSan, dedicated preset; never applied to WASM).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cmake --preset native-sanitizer -S "$ROOT/engine" 2>&1 | tail -n 2
cmake --build "$ROOT/engine/build/native-sanitizer" 2>&1 | tail -n 3
ctest --test-dir "$ROOT/engine/build/native-sanitizer" --output-on-failure 2>&1 | tail -n 4
