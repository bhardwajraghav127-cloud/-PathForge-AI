#!/usr/bin/env bash
# Environment check: reports present/missing tools, never fails silently.
set -euo pipefail
echo "== PathForge setup check =="
for t in clang++ git cmake ninja python3 node npm brew; do
  if command -v "$t" >/dev/null 2>&1; then
    echo "OK   $t: $(command -v "$t")"
  else
    echo "MISS $t"
  fi
done
if [ -f "$HOME/emsdk/emsdk_env.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/emsdk/emsdk_env.sh" >/dev/null 2>&1 || true
fi
if command -v emcc >/dev/null 2>&1; then
  echo "OK   emcc: $(emcc --version 2>/dev/null | head -n 1)"
else
  echo "MISS emcc (source ~/emsdk/emsdk_env.sh or install per docs/architecture/toolchain.md)"
fi
echo "disk:"; df -h / | tail -n 1
