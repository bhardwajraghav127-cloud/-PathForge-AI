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
