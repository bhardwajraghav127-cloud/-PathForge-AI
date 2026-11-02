# PathForge AI 2.0 — features vs limitations

## Real algorithmic computation
- All routing: Dijkstra / A* in C++17, compiled to native + WebAssembly.
- Alternatives: Yen K-shortest paths. Traversal/MST: BFS/DFS/Prim/Kruskal.
- Every diversion decision: stateless C++ policy over live overlay +
  position (STAY / RECOMMEND / REROUTE_REQUIRED / NO_ROUTE).
- ETAs/durations/distances: engine `route.evaluate` per directed arc.
- Demo incident targeting: deterministic search calling the real policy.
- Fleet effects: per-vehicle engine checks; relevance is policy-decided.
- Evidence drawer: per-edge engine re-evaluation with sums-vs-total match.
- Native↔WASM parity: 32/32 fixtures byte-identical (masked metadata).

## Simulated (explicitly labeled in-UI)
- The 20-city network, distances, times, tolls: synthetic, plausible.
- Incidents/closures/congestion: user- or script-triggered overlay edits.
- Vehicles, clocks, speed multipliers: simulation presentation.
- "Savings": engine estimates at decision time, never realized savings.
- Emergency drill: fastest-path preset with honest no-dispatch disclaimer.

## Roadmap to real roads (not implemented)
- Import OSM graph extracts; map-match GPS traces; calibrate weights.
- Live feeds would need versioned overlay ingestion + staleness policy.
- Fleet capacity/routing with time windows is a separate optimization layer.
