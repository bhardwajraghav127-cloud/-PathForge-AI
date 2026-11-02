# PathForge AI 2.0 — Viva Q&A

## Dijkstra
- Runs on directed road arcs; weight = effective seconds under the overlay.
- Optimal for nonnegative weights. O((V+E) log V), binary heap.
- Sources: `engine/src/dijkstra.cpp`, `engine/src/objectives.cpp`.

## A*
- Same weights + straight-line heuristic. Optimal only if the heuristic is
  admissible (never overestimates). O((V+E) log V) worst case.
- Source: `engine/src/astar.cpp`.

## Yen K-shortest paths
- Ranked loop-less alternatives over identical engine weights; powers the
  Compare tab, demo alternates, and the evidence drawer deltas.
- Source: `engine/src/yen.cpp`.

## BFS / DFS
- Unweighted traversal; BFS gives fewest-hop order. O(V+E).
- Sources: `engine/src/traversal.cpp`, traces in `engine/src/lab.cpp`.

## MST (Prim / Kruskal)
- Lab runs both and checks agreement (FOREST when closures split the graph).
- Kruskal O(E log E) with DSU; Prim O((V+E) log V).
- Sources: `engine/src/prim.cpp`, `engine/src/kruskal.cpp`.

## Multi-stop
- Leg matrix of engine shortest paths + ordering heuristic. Exact TSP is
  NP-hard, so the ordering is heuristic while every leg stays optimal.

## Diversion policy
- Stateless: STAY / RECOMMEND_DIVERSION / REROUTE_REQUIRED /
  NO_ROUTE_AVAILABLE from engine facts only. Cooldowns, dismissal
  signatures, blocked-alert bypass. Accept validates overlay version +
  position fingerprint (stale accepts fail safe).
- Source: `engine/src/diversion.cpp`.

## WASM architecture
- React → EngineClient (typed calls, per-channel stale suppression) →
  Web Worker → WASM `pf_execute(JSON)` → C++ engine → JSON → Zod → store.
- Native `pf_contract_runner` is the independent E2E oracle; parity is
  byte-compared on 32 fixtures (masked timings/build).

## Data structures
- Adjacency lists, binary heaps, DSU, hash maps for overlays/policies.

## Simulation limitations (say honestly)
- Synthetic 20-city network; times/distances are plausible, not measured.
- No live GPS, traffic, dispatch, or hospitals. Speed multipliers compress
  simulated time; animation follows engine durations, never the reverse.
- "AI" = classical algorithms + policy. No machine learning is claimed.

## Design tradeoffs
- Stateless engine: deterministic, WASM-safe, testable; UI holds state.
- Engine calls on events only, never per animation frame (fleet scales).
- Closures/congestion are overlay inputs; the base graph is never mutated.
