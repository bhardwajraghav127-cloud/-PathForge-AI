# C3 demo report (M11 rehearsal)

Executable path: `frontend/e2e/demo.spec.ts` (14 steps, all green) plus the
AC suites. Environment: macOS arm64, system Chrome headless, production
`vite preview` build, real WASM engine, native-runner oracles.

## 14 steps and observed facts

1. Dashboard renders `20 vertices · 42 roads (north-india-sim-v1)`.
2. Route Planner finds Chandigarh → Delhi, FASTEST.
3. Seven arcs `ex01:f…ex07:f`; time `13080 s`, distance `334257 m`, toll `590`.
4. Three Yen alternatives listed with engine times.
5. Why This Route: deltas vs best plus shared-arc counts from route.compare.
6. Jam `i1` on ex06 → overlay v2, route still found after auto-recompute.
7. Closure of ex03 → overlay v3, reroute via `gt01:f…gt04:f`, time `16740 s`.
8. Scenario snapshot `demo-closed` + compare: 3 rows with engine deltas.
9. Multi-stop delhi/chandigarh/karnal/ambala → OPTIMAL held-karp,
   order delhi → karnal → ambala → chandigarh, `14737 s`.
10. Journey starts; vehicle fracPermille rises on `ex01:f` (no jumps).
11. Lab BFS from `a` visits `a → …` in deterministic order.
12. Lab MST_PRIM reports weight `30 m` on the tiny graph.
13. Settings toggles dark theme (persists across reload).
14. Zero console/page errors on every page.

## Marginal vs major (AC-12, from journey.spec.ts)

- Marginal jam on ex06: engine `STAY — CURRENT_IS_BEST`, no banner.
- Major crawl (ex04 at 10% speed): `RECOMMEND_DIVERSION — THRESHOLD_MET`,
  saving `14484 s` (threshold 600 s), banner == oracle.
- Blocked ex04: `REROUTE_REQUIRED`, accept adopts the candidate starting at
  the occupied arc (no teleport); stay/accept persist to localStorage.

## Coverage (measured, `scripts/coverage.sh`)

Line coverage, gtest + contract fixtures + bench executions: astar 96.4,
dijkstra 90.8, graph 94.2, objectives 91.6, traversal 100.0, prim 100.0,
kruskal 100.0. Below the 90% aspiration: multistop 80.5, position 85.6,
yen 51.1, lab 71.3, diversion 69.0, engine 74.1.
Status: documented exception — the shipped gates (65/65 gtest, sanitizers,
32/32 parity, 9/9 E2E) all pass; closing the gap needs user approval (C3).

## Security audit (`npm audit`, M11)

- Before: react-router high (SSR/action vectors), zod high (DoS on oversized
  collections).
- After: `react-router-dom@7.18.5`, `zod@4`, `vite@7` — `npm audit` reports
  **0 vulnerabilities** (production and dev). Full E2E re-verified on the
  upgraded stack (9/9 green).
- Residual notes: dev-only vite advisories are gone with vite@7; zod v4
  `z.record` call sites updated (one-line fix), behavior re-verified by E2E.
  Inputs remain bounded (vendored dataset, engine-produced envelopes).
