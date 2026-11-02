#!/usr/bin/env bash
# WASM build: same C++ sources -> single-threaded ES module for a Vite worker.
# Flags validated against installed emcc (see docs/architecture/toolchain.md).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$HOME/emsdk/emsdk_env.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/emsdk/emsdk_env.sh" >/dev/null 2>&1
fi
command -v emcc >/dev/null 2>&1 || { echo "BLOCKED: emcc missing"; exit 1; }
OUT="$ROOT/frontend/src/worker/wasm"
mkdir -p "$OUT"
# All engine sources except the native-only contract runner.
# shellcheck disable=SC2206
SRCS=( "$ROOT"/engine/src/*.cpp "$ROOT"/engine/src/bindings/*.cpp )
FILTERED=()
for f in "${SRCS[@]}"; do
  case "$f" in
    *contract_runner.cpp) ;;
    *) FILTERED+=( "$f" ) ;;
  esac
done
em++ "${FILTERED[@]}" \
  -I"$ROOT/engine/include" \
  -I"$ROOT/engine/build/native-release/_deps/nlohmann_json-src/include" \
  -std=c++17 -O2 \
  -DPF_BUILD_WASM=1 \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sENVIRONMENT=worker,node \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS=_pf_execute,_pf_free,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,lengthBytesUTF8,stringToUTF8,UTF8ToString \
  -sNODEJS_CATCH_EXIT=0 \
  -o "$OUT/pathforge.mjs"
ls -la "$OUT"
echo "WASM BUILD OK"
