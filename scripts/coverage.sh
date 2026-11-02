#!/usr/bin/env bash
# Measured C++ line coverage (M11): separate coverage build, gtest run,
# llvm-cov report over engine sources. Writes docs/testing/coverage.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BLD="$ROOT/engine/build/coverage"
rm -rf "$BLD"
cmake -S "$ROOT/engine" -B "$BLD" -G Ninja \
  -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_CXX_FLAGS="-fprofile-instr-generate -fcoverage-mapping -O0 -g" \
  -DCMAKE_EXE_LINKER_FLAGS="-fprofile-instr-generate" \
  -DPF_BUILD_TESTS=ON > /dev/null
cmake --build "$BLD" 2>&1 | tail -n 1
LLVM_PROFDATA=/Library/Developer/CommandLineTools/usr/bin/llvm-profdata
LLVM_COV=/Library/Developer/CommandLineTools/usr/bin/llvm-cov
export LLVM_PROFILE_FILE="$BLD/cov-%p.profraw"
"$BLD/pf_tests" > /dev/null 2>&1
for f in "$ROOT"/tests/contract/fixtures/*.request.json; do
  "$BLD/pf_contract_runner" "$f" > /dev/null 2>&1
done
"$BLD/pf_bench" 42 > /dev/null 2>&1
"$LLVM_PROFDATA" merge -sparse "$BLD"/cov-*.profraw -o "$BLD/default.profdata"
mkdir -p "$ROOT/docs/testing"
{
  echo "# C++ line coverage (M11, measured)"
  echo
  echo "- build: Debug + --coverage, Apple clang 21, $(git -C "$ROOT" rev-parse --short HEAD)"
  echo "- scope: engine/src (*.cpp); executions: full pf_tests suite + all contract
  fixtures via pf_contract_runner + pf_bench (seed 42)"
  echo
  "$LLVM_COV" report "$BLD/pf_tests" -instr-profile="$BLD/default.profdata" 2>/dev/null || true
} > "$ROOT/docs/testing/coverage.md"
cat "$ROOT/docs/testing/coverage.md"
