# Toolchain (M0 observed + M1 plan)

## Observed 2026-11-02 (macOS arm64, 27.0.1)
- Apple clang 21.0.0 (C++17 OK), git 2.54.0, python 3.14.7, node 26.10.0, npm 11.19.1, brew 7.0.11
- MISSING: cmake, ninja, emcc/EmsDK

## Install plan (REQUIRES C0 APPROVAL — NOT executed)
1. `brew install cmake ninja` (Homebrew, user-space Cellar, no sudo)
2. Emscripten via user-space `~/emsdk` clone + `./emsdk install <pinned> && ./emsdk activate <pinned]` (exact version pinned after docs check when network use approved)
3. `npm` deps installed per-project under `pathforge-ai/frontend` (lockfile, no global installs)
4. GoogleTest + nlohmann/json pinned (vendored or CMake FetchContent with checksums; versions recorded in dependencies.md)

## Portability
- Scripts use `#!/usr/bin/env bash` + `set -euo pipefail`, no GNU-only flags
- Support Apple Silicon + Intel; build flags validated per-machine
- No `sudo`, no `curl | sh`, no force-push, no secrets

## Verification (M1)
- `clang++ --version`, `cmake --version`, `ninja --version`, `emcc --version` re-run post-install
- Native round trip before WASM scale-up; flags taken from installed Emscripten version, not copied blindly
