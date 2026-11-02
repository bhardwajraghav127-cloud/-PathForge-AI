#!/usr/bin/env bash
# Anti-fake guard (M11): fail if TypeScript implements pathfinding itself.
# Forbids TS definitions of core graph algorithms and heap internals; UI
# labels, engine-result rendering and test oracle data are unaffected.
# Also asserts the worker delegates execution to the WASM C++ module.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/frontend/src"
fail=0

ban() {
  local pat="$1" desc="$2"
  local hits
  hits=$(grep -rniE --include='*.ts' --include='*.tsx' "$pat" "$SRC" || true)
  if [ -n "$hits" ]; then
    echo "ANTIFAKE VIOLATION ($desc):"
    echo "$hits"
    fail=1
  fi
}

ban 'function[[:space:]]+(dijkstra|astar|aStar|yen|heldKarp|held_karp|prims?|kruskal|bellmanFord|floydWarshall)[[:space:]]*\(' 'TS pathfinding function'
ban '(class|function)[[:space:]]+(PriorityQueue|MinHeap|BinaryHeap|FibonacciHeap|DSU|DisjointSet|UnionFind)' 'TS heap/DSU implementation'
ban '(extractMin|decreaseKey|relaxEdge)[[:space:]]*(\(|:|=[^=])' 'TS heap internals'
ban 'new[[:space:]]+(PriorityQueue|MinHeap|BinaryHeap)' 'TS heap instantiation'

if ! grep -q 'pf_execute' "$SRC/worker/engine.worker.ts"; then
  echo "ANTIFAKE VIOLATION: worker does not delegate to pf_execute (WASM engine)"
  fail=1
fi

# No test doubles in production source: no MSW/mocked engine client.
if grep -rliE --include='*.ts' --include='*.tsx' '(msw|MockEngine|__mocks__)' "$SRC" | grep -v '.test.' | grep .; then
  echo "ANTIFAKE VIOLATION: test double in production source"
  fail=1
fi

if [ "$fail" -eq 0 ]; then echo "antifake: PASS (no TS pathfinding, worker delegates to WASM)"; fi
exit "$fail"
