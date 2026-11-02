# Data provenance — north-india-sim-v1 (SIMULATED, not a real map)

**SIMULATED DATA — NOT LIVE GPS OR TRAFFIC.** Every coordinate is approximate,
every distance is `ceil(haversine × detour)`, every time derives from a synthetic
speed, every toll is invented. Road names are generic ("Simulated express").
Nothing here describes real road geometry, real travel times, or real tolls.

## Generation
`datasets/generate_north_india.py` (deterministic, no randomness):
- 20 approximate town coordinates (public knowledge, 2-decimal precision).
- Per road: detour factor 1.15–1.35 by road class, class speeds 55–95 km/h,
  synthetic tolls on express segments only.
- `distanceM = ceil(hav × detour)`, `baselineTimeS = ceil(dist / speed)`.
- Corridors: C1 eastern express (tolled, fastest), C2 grand trunk (free,
  shorter, slower), C3 western (mixed toll), plus east link and cross links.
- Structural choices: 4 one-way carriageway roads, 4 parallel pairs,
  Jind as a single-access leaf (wr10 only), Meerut as an eastern stub.

## Design intent (verified by test_dataset.cpp, never hardcoded answers)
- Shortest (trunk, ~283km) differs from fastest (express, ~218min).
- Lowest-toll (free trunk) differs from fastest (tolled express).
- 3+ mutually diverse Chandigarh→Delhi corridors (diversity policy enforced).
- Marginal preset (+~7min) vs major preset (+~320min) separation for the M4
  diversion thresholds (10min) with real computed margins.
- Central closure (ex03) keeps an alternative; leaf closure (wr10) isolates Jind.
- One-way carriageways only traversed in their legal direction.
- All distances satisfy A* admissibility (distanceM >= haversine).

## Limitations and future work
- No elevation, signals, turn penalties, or time-of-day profiles.
- No OpenStreetMap data. Any future OSM use requires ODbL attribution and a
  rebuild of the provenance record — see docs/FUTURE.md (M12).
