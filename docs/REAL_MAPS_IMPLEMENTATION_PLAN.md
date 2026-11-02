# Real Maps implementation plan (R0)

Branch: `real-maps-3.0` (from `fleet-2.0` @ `ffde047`, clean tree).
Baseline preserved: `main`, `ui-redesign`, `fleet-2.0`, tags `m1-verified…v1.0.0`
untouched. No uncommitted work existed; no other agents active.

## Product scope
Add a **Real Roads** mode (real OSM geometry + C++/WASM routing) alongside the
existing **Simulation Network** mode. Keep every 2.0 feature working in sim
mode: dashboard, planner, journey, multi-stop, scenarios, lab, smart demo,
fleet, explainability, viva mode.

## Data decision (availability-driven)
- Preferred region (Chandigarh tri-city) is unreachable: Overpass endpoints
  return 406/403/unreachable from this network, and no city extract exists.
- Decision: bounded **New Delhi** demo region from BBBike
  (`https://download.bbbike.org/osm/bbbike/NewDelhi/`, ODbL, updated weekly,
  37 MB PBF as of 2026-10-31). Thematically consistent (sim network anchors
  at Delhi). Raw file stays in `/tmp`, never committed; only the small
  derived graph + provenance doc ship in-repo.
- Pipeline `scripts/osm_build_graph.py` (stdlib only): stream-parse
  `.osm.gz`, bbox-clip, keep drivable `highway=*`, build intersection
  graph with chain-merged edges, haversine distances, one-way rules,
  road-class speed assumptions (documented), gazetteer from `place=*`.
- Disclosed limits: no turn restrictions/relations, no live traffic/GPS,
  times are class-based estimates, pedestrian/bike/car legality not implied.

## Rendering decision
**MapLibre GL JS (npm, open-source) with a fully local style**: background +
pipeline-generated GeoJSON (roads, places, routes). No tile servers involved,
so the demo is ₹0, offline-capable, and free of tile usage-policy risk.
Optional opt-in CARTO raster basemap (free with attribution, explicit toggle,
graceful offline fallback). OSM attribution always visible.

## Engine integration
- Real graph ships as engine-format JSON + geometry sidecar keyed by road id.
- Vertex budget ≈ 3–8k after chain-merging (tune bbox to fit).
- A* admissibility: `distanceM` = haversine sums ≥ straight-line distance by
  construction; the engine's own gate re-verifies per call.
- `route.find` results already expose visited/relaxed/heap stats (no C++
  changes expected); parity fixtures generated from the real graph.

## Milestones & acceptance
- R1: MapLibre page renders local roads, attribution, offline fallback. Test:
  page loads with network blocked.
- R2: pipeline + validated graph (connectivity, one-ways, stable IDs).
  Test: script + validation report.
- R3: real routing via WASM = native (parity), polylines on true geometry,
  click-to-route + gazetteer search. Test: known reachable/unreachable pairs.
- R4: real-road smart demo end-to-end, deterministic. Test: E2E stage walk.
- R5: 5-vehicle real fleet, dispatch board, sandbox, SLA, replay. Test: E2E.
- R6: why-panel with real stats, inspector, Dijkstra-vs-A* race, viva walk.
- R7: polish, 390px mobile, keyboard, benchmarks, offline pack.
- R8: full suite green, docs, screenshots, release notes.

## Risk register
- Graph too large for per-call JSON → mitigate: bbox sizing, chain merging,
  measure before/after (abort threshold: p95 route > 2 s).
- Delhi bbox choice → verify drivable connectivity + known pairs in R2.
- MapLibre+Vite worker bundling → verify in R1 with production build.
- npm/CDN flakiness → pin versions, commit lockfile.

## Completion record (R8)
All milestones done on `real-maps-3.0`, engine untouched (C++17, antifake
green), all 2.0 sim features preserved and passing.

- R1: `/real` MapLibre page, fully local style + worker, attribution,
  SourceBadge, opt-in CARTO with offline revert. E2E: zero external
  requests, keyboard canvas, blocked-network load.
- R2: `scripts/osm_build_graph.py` + `real-delhi-{network,geometry,
  places}.json`: 7,052 vertices / 9,423 directed roads / ~596 km,
  bbox 28.60–28.65N 77.20–77.25E; 19 v→v loops dropped, 0 dangling /
  mismatch / inadmissible; largest weak component kept.
- R3: `route.find`/`alternatives`/`evaluate` on the real graph via
  WASM = native (34/34 parity incl. 2 real fixtures); true-polyline
  render, gazetteer + click snap, honest unreachable. CP→CV: 65
  segments / 236 s (est.), Dijkstra visited 6961.
- R4: `/real-demo` deterministic script (r01105, BLOCKED_CURRENT_PLAN),
  accept/stay receipts (overlay v3), summary counts. E2E 3/3.
- R5: `/real-fleet` 5 verified pairs, independent clocks/policies,
  request-time position freeze, failure backoff, trial-verified
  incident injection (≥30 sim-s lookahead), dispatch board, priority
  cadence (180/60 sim-s), in-sim SLA (1.5× planned), click-a-road
  sandbox (closures/factors), emergency drill, 5 Hz replay timeline,
  reconciled KPIs. E2E 6/6. Fixed en route: stale-snapshot SLA
  overwrite, accept position race.
- R6: `/real-lab` Dijkstra-vs-A* race on `lab.run` traces (settled
  waves, scrub/play), stats table + verdict, why-panel with receipts,
  road inspector (facts + race usage + overlay state), 6-question viva
  walkthrough linked to live pages. E2E 4/4.
- R7: responsive `.pf-map-tall` heights (390px: 300px),
  `scripts/bench-real-maps.sh` → `docs/benchmarks/REAL_MAPS_BENCH.md`
  (route.find medians: native ~11.6 ms, WASM ~30 ms, 21 reps; abort
  threshold never approached), mobile/keyboard/offline E2E 3/3,
  `npm audit` 0 vulnerabilities.
- R8: `verify-all.sh` EXIT=0 — 65/65 gtest, 65/65 sanitizer, 34/34
  parity, 52/52 E2E, bench + antifake PASS. Screenshots
  `docs/screenshots/real-{route,demo,fleet,lab}.png` regenerated by
  `e2e/screenshots.spec.ts` from live runs.

Genuine limits (unchanged): one small Delhi bbox; class-assumed speeds
(estimates, not traffic); no turn restrictions; no live GPS/traffic/
dispatch — every real page carries `SIMULATION — NOT LIVE GPS,
DISPATCH OR TRAFFIC`. Budget: ₹0 (no keys, no paid tiles).
