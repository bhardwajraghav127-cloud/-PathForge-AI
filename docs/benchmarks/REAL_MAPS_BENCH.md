# PathForge AI real-maps benchmarks (R7)

- date: 2026-11-02T20:24:34Z
- machine: arm64 27.0.1
- compiler: Apple clang version 21.0.0 (clang-2100.3.34.2)
- commit: 4647188
- graph: New Delhi OSM bbox 28.60-28.65N 77.20-77.25E (7,052 vertices / 9,423 directed roads)
- metric: engine-reported stats.elapsedUs per route.find call (excludes harness IPC)
- reps: 21 per cell

## route-find-real-001 (DIJKSTRA)

- native: median_us=11561 p95_us=12301 min_us=10908 max_us=12514 n=21
- wasm:   median_us=29883 p95_us=30668 min_us=29416 max_us=34557 n=21

## route-find-real-002 (A_STAR)

- native: median_us=11960 p95_us=12424 min_us=11448 max_us=12705 n=21
- wasm:   median_us=30078 p95_us=31070 min_us=29599 max_us=31271 n=21

