#!/usr/bin/env bash
# Micro-benchmarks (M11/REQ-20): native seeded grid graphs, bounded sizes.
# Writes CSV + Markdown with machine/compiler/flags/commit/seed provenance.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/engine/build/native-release/pf_bench"
[ -x "$BIN" ] || { echo "BLOCKED: pf_bench missing (build native first)"; exit 1; }
mkdir -p "$ROOT/docs/benchmarks"
SEED="${1:-42}"
"$BIN" "$SEED" > "$ROOT/docs/benchmarks/bench.csv"
{
  echo "# PathForge AI micro-benchmarks (M11)"
  echo
  echo "- date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- machine: $(uname -m) $(sw_vers -productVersion 2>/dev/null || true)"
  echo "- compiler: $(c++ --version | head -n 1)"
  echo "- flags: -O3 -DNDEBUG (native-release preset)"
  echo "- commit: $(git -C "$ROOT" rev-parse --short HEAD)"
  echo "- seed: $SEED"
  echo "- graphs: seeded grids 10x10 / 32x32 / 70x70 (100/1024/4900 nodes)"
  echo "- reps: 20 / 10 / 5; columns: median_ms, p95_ms, visited_or_edges, heap_ops"
  echo
  echo '```'
  cat "$ROOT/docs/benchmarks/bench.csv"
  echo '```'
} > "$ROOT/docs/benchmarks/BENCH.md"
cat "$ROOT/docs/benchmarks/bench.csv"
