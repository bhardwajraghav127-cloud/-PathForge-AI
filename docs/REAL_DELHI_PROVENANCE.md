# Real Delhi data provenance (R2)

- **Source:** BBBike OSM extract `NewDelhi.osm.gz`
  (`https://download.bbbike.org/osm/bbbike/NewDelhi/`), Last-Modified
  2026-11-01, 75,926,018 bytes.
- **License:** OpenStreetMap data © contributors, ODbL 1.0. Attribution
  shown in-app (map attribution control + Map Source badge). No tile
  servers used; no additional provider terms apply to the local style.
- **Build:** `python3 scripts/osm_build_graph.py /tmp/NewDelhi.osm.gz
  --bbox 28.60,77.20,28.65,77.25 --out frontend/src/data/real-delhi`
  (stdlib only, deterministic). Raw extract stays in `/tmp`, never committed.
- **Outputs:** `real-delhi-network.json` (2.2 MB engine graph),
  `real-delhi-geometry.json` (1.4 MB render sidecar),
  `real-delhi-places.json` (343-entry gazetteer).
- **Graph:** 7,052 vertices (intersections), 9,423 directed roads
  (chain-merged, 2,948 one-way), 596 km. Largest weakly-connected
  component kept; 19 v→v roundabout stubs dropped.
- **Costs:** `distanceM` = haversine sums along OSM geometry (A*-admissible
  by construction, engine re-verifies). `baselineTimeS` = distance ÷
  class assumed speed (motorway 80 … service 20 km/h) — documented
  assumptions, NOT measured traffic.
- **Validation:** 0 dangling refs, 0 geometry-endpoint mismatches,
  0 inadmissible edges; 6/6 random pairs reachable, ~12 ms native.
- **Disclosed limits:** turn restrictions/relations ignored; maxspeed tags
  ignored; bbox clips boundary ways; times are estimates; no live GPS or
  traffic; car-legality of every movement not asserted.
