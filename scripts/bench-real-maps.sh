#!/usr/bin/env bash
# Real-maps benchmarks (R7): engine-reported elapsedUs for route.find over the
# full 7,052-vertex / 9,423-road OSM graph, native vs WASM, 21 reps each.
# Writes docs/benchmarks/REAL_MAPS_BENCH.md with provenance. No network.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE="$ROOT/engine/build/native-release/pf_contract_runner"
HARNESS="$ROOT/scripts/wasm-harness.mjs"
[ -x "$NATIVE" ] || { echo "BLOCKED: native runner missing (run build-engine-native.sh)"; exit 1; }
[ -f "$ROOT/frontend/src/worker/wasm/pathforge.mjs" ] || { echo "BLOCKED: wasm missing (run build-wasm.sh)"; exit 1; }
mkdir -p "$ROOT/docs/benchmarks"
REPS="${1:-21}"

collect() {
  local runner="$1" fixture="$2"
  local -a vals=()
  for ((i = 0; i < REPS; i++)); do
    if [ "$runner" = "native" ]; then
      out="$("$NATIVE" "$fixture")"
    else
      out="$(node "$HARNESS" "$fixture")"
    fi
    v=$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["stats"]["elapsedUs"])')
    vals+=("$v")
  done
  printf '%s\n' "${vals[@]}" | python3 -c '
import sys, statistics
v = sorted(int(x) for x in sys.stdin.read().split())
n = len(v)
p95 = v[min(n - 1, int(-(-95 * n // 100)) - 1)]
print(f"median_us={statistics.median(v):.0f} p95_us={p95} min_us={v[0]} max_us={v[-1]} n={n}")'
}

{
  echo "# PathForge AI real-maps benchmarks (R7)"
  echo
  echo "- date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- machine: $(uname -m) $(sw_vers -productVersion 2>/dev/null || true)"
  echo "- compiler: $(c++ --version | head -n 1)"
  echo "- commit: $(git -C "$ROOT" rev-parse --short HEAD)"
  echo "- graph: New Delhi OSM bbox 28.60-28.65N 77.20-77.25E (7,052 vertices / 9,423 directed roads)"
  echo "- metric: engine-reported stats.elapsedUs per route.find call (excludes harness IPC)"
  echo "- reps: $REPS per cell"
  echo
  for fx in route-find-real-001 route-find-real-002; do
    algo="$(python3 -c "import json; print(json.load(open('$ROOT/tests/contract/fixtures/$fx.request.json'))['payload']['algorithm'])")"
    echo "## $fx ($algo)"
    echo
    echo "- native: $(collect native "$ROOT/tests/contract/fixtures/$fx.request.json")"
    echo "- wasm:   $(collect wasm "$ROOT/tests/contract/fixtures/$fx.request.json")"
    echo
  done
} | tee "$ROOT/docs/benchmarks/REAL_MAPS_BENCH.md"
