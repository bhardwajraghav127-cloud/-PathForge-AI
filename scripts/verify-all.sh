#!/usr/bin/env bash
# verify-all.sh (M1 scope): runs all CURRENTLY IMPLEMENTED mandatory stages.
# Later stages print NOT_APPLICABLE (never falsely PASSED). Fails fast.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pass=(); fail=(); na=()

run() { # name, command...
  local name="$1"; shift
  echo "=== STAGE: $name ==="
  if "$ROOT/scripts/$1" ${*:2}; then echo "--- $name: PASS"; pass+=("$name");
  else echo "--- $name: FAIL"; fail+=("$name"); fi
}

bash "$ROOT/scripts/setup-check.sh"
run "native-build" build-engine-native.sh
run "unit-tests" test-engine.sh
run "wasm-build" build-wasm.sh
run "contract-parity" test-contract.sh
run "frontend-build" build-frontend.sh
na+=("e2e (mandatory from M6)")

echo; echo "########## SUMMARY ##########"
echo "PASS: ${pass[*]:-none}"
echo "FAIL: ${fail[*]:-none}"
echo "NOT_APPLICABLE: ${na[*]}"
[ "${#fail[@]}" -eq 0 ]
