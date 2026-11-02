# PathForge AI — Intelligent Route Optimization & Graph Algorithm Visualization System

> **SIMULATION — NOT LIVE GPS, DISPATCH OR TRAFFIC.** All roads, times, tolls and
> incidents are synthetic (`datasets/sample-networks/north-india-sim-v1.json`,
> 20 vertices / 42 roads). See `docs/data-provenance.md` before reusing the
> dataset; OpenStreetMap data carries ODbL obligations if you substitute it.

An intelligent traffic & fleet decision system: one-click Smart Journey Demo,
5-vehicle Fleet Command Center, explainable routing, and an ADSA laboratory.
Every route, diversion, multi-stop tour and lab trace is computed by a genuine
C++17 engine compiled to WebAssembly; React + TypeScript + Cytoscape.js only
render engine facts. There is no pathfinding in TypeScript —
`scripts/antifake.sh` enforces this.

Faculty fast path: start the app, open `#/demo`, click **Start Smart Demo**.
Full script: `docs/V2_DEMO_SCRIPT.md`; Q&A bank: `docs/V2_VIVA_QA.md`.

**3.0 Zero-Cost Real Maps** (branch `real-maps-3.0`, R0–R8 complete): the same
C++/WASM engine now also routes on genuine OpenStreetMap streets — a validated
7,052-vertex / 9,423-road directed graph of New Delhi rendered with MapLibre
from a fully local style (₹0, no keys, offline-capable). New pages: Real Roads
planner, Real Smart Demo, Real Fleet Command, Real Lab (Dijkstra-vs-A* race,
inspector, viva walkthrough). Plan + completion record:
`docs/REAL_MAPS_IMPLEMENTATION_PLAN.md`; benchmarks:
`docs/benchmarks/REAL_MAPS_BENCH.md`; captures:
`docs/screenshots/real-{route,demo,fleet,lab}.png`. OSM data © OpenStreetMap
contributors (ODbL); times are class-based estimates, incidents simulated.

## Quickstart (fresh clone)

Prerequisites: `cmake`, `ninja`, Node 20+, and Emscripten (`emsdk`) for the
WASM build. macOS: `brew install cmake ninja`; `git clone
https://github.com/emscripten-core/emsdk.git ~/emsdk && ~/emsdk/emsdk
install latest && ~/emsdk/emsdk activate latest`.

```bash
git clone <this-repo> pathforge-ai && cd pathforge-ai
source ~/emsdk/emsdk_env.sh          # WASM build only
bash scripts/verify-all.sh           # full gate: native, tests, sanitizer,
                                     # WASM, parity, frontend, E2E, bench
cd frontend && npm ci && npm run dev  # open the printed localhost URL
```

Useful commands:

| Command | What it proves |
|---|---|
| `bash scripts/build-engine-native.sh` | C++17 engine builds warning-clean |
| `bash scripts/test-engine.sh` | 65/65 gtest (oracles, edge cases, fuzz) |
| `bash scripts/test-sanitizer.sh` | ASan+UBSan clean |
| `bash scripts/test-contract.sh` | 32/32 native↔WASM parity (masked volatile fields) |
| `bash scripts/bench-engine.sh [seed]` | Seeded micro-benchmarks → `docs/benchmarks/` |
| `bash scripts/coverage.sh` | Measured line coverage → `docs/testing/coverage.md` |
| `bash scripts/antifake.sh` | No TS pathfinding; worker delegates to WASM |
| `cd frontend && npx playwright test` | 32/32 browser E2E incl. demo, fleet, explain, mobile |

## Architecture

```
React pages ──► EngineClient ──► WASM worker ──► C++ engine (Dijkstra/A*/Yen/
(MapWorkspace)   (typed, stale-        (pf_execute)   Held-Karp/Prim/Kruskal/
                  suppressed)                         diversion/lab)
      ▲                                                  ▲
      └────────────── engine facts only ─────────────────┘
```

Pages: Dashboard, Smart Demo, Fleet Command Center, Route Planner, Journey
Simulator, Multi-Stop Planner, Scenario Comparison, Algorithm Laboratory,
Settings, plus 3.0 Real Roads, Real Demo, Real Fleet, Real Lab — see
`docs/architecture/` and `docs/V2_ARCHITECTURE_AND_BASELINE.md`. The engine ABI is a stateless JSON envelope
(`engine.info`, `route.find/alternatives/evaluate/compare/multistop`,
`lab.run/compare`, `scenario.compare`, `diversion.evaluate`,
`network.validate`).

## ADSA coverage

| Feature | Algorithm | Evidence |
|---|---|---|
| Traversal lab | BFS (queue), DFS (stack) | `test_traversal.cpp`, lab E2E |
| Shortest path | Dijkstra + binary heap, lexicographic tie-break | `test_dijkstra.cpp`, 63+ gtest |
| Heuristic search | A* (haversine, admissibility gate, h=0 fallback) | `test_astar.cpp`, A*≡Dijkstra seeds |
| Alternatives | Yen K-shortest + diversity filter | `test_yen.cpp`, brute-force oracle |
| Multi-stop | Held-Karp exact ≤10, nearest-neighbor + 2-opt | permutation oracle, AC-18 OPTIMAL |
| MST | Prim (lazy heap) + Kruskal (DSU), forest-aware | agreement oracle, AC-19 30 m |
| Ordering/sort | Kahn topo-sort, merge-sort vs `stable_sort` | `test_algorithms.cpp` |
| Dynamic rerouting | Diversion engine (thresholds ≥, cooldown, STAY/RECOMMEND/REROUTE) | 8 diversion suites, AC-12 |
| Benchmarks | Seeded grids 100–4900 nodes, median/p95 | `docs/benchmarks/BENCH.md` |

## Verification status

M0–M11 verified with tags `m1-verified … m11-verified`; release `v1.0.0`.
65/65 gtest, sanitizers clean, 32/32 parity, 32/32 E2E, audit 0 findings.
2.0 work-in-progress lives on branch `fleet-2.0` (V0–V8, unmerged).
3.0 on branch `real-maps-3.0`: 65/65 gtest, sanitizers clean, 34/34 parity
(incl. 2 real-graph fixtures), 52/52 E2E, antifake PASS, audit 0 findings.
Traceability: `docs/TRACEABILITY.md` (44 VERIFIED). Known exception: C++
line coverage below the 90% aspiration in `yen/lab/diversion/engine`
— see `docs/testing/c3-demo-report.md`.

## Viva in 60 seconds

1. Plan Chandigarh → Delhi (FASTEST): 7 arcs, `13080 s`, `334257 m`.
2. Report a jam on `ex06`, close `ex03`: auto-recompute reroutes
   (`16740 s`) with attribution to incident `i1`.
3. Journey at 600×: marginal jam → STAY; crawl on `ex04` →
   RECOMMEND (saving `14484 s` ≥ 600 s); accept continues without teleport.
4. Lab: BFS order, Dijkstra≡A* (`20 s` on tiny), Prim≡Kruskal (`30 m`).
Full script: `docs/demo-script.md`. Q&A bank: `docs/viva.md`.

## Resume bullets

- Built a C++17 routing engine (Dijkstra/A*/Yen/Held-Karp/Prim/Kruskal,
  diversion policy) compiled to WASM with 65/65 gtest + ASan/UBSan clean.
- Drove 32/32 Playwright E2E against real-engine oracles (native binary as
  independent checker), incl. smart demo, 5-vehicle fleet, explainability and
  mobile flows.
- Measured native↔WASM parity (32/32), seeded benchmarks to 4900 nodes, and
  line coverage; shipped zero-vulnerability deps and release `v1.0.0`.

License: MIT (`LICENSE`).
