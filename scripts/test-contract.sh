#!/usr/bin/env bash
# Native <-> WASM contract parity over all fixtures (semantic diff).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE="$ROOT/engine/build/native-release/pf_contract_runner"
[ -x "$NATIVE" ] || { echo "BLOCKED: native runner missing (run build-engine-native.sh)"; exit 1; }
[ -f "$ROOT/frontend/src/worker/wasm/pathforge.mjs" ] || { echo "BLOCKED: wasm missing (run build-wasm.sh)"; exit 1; }
pass=0; fail=0
for f in "$ROOT"/tests/contract/fixtures/*.request.json; do
  base="${f%.request.json}"
  "$NATIVE" "$f" > "$base.native.json"
  node "$ROOT/scripts/wasm-harness.mjs" "$f" > "$base.wasm.json"
  if python3 "$ROOT/scripts/semantic_diff.py" "$base.native.json" "$base.wasm.json"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
done
echo "contract parity: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
