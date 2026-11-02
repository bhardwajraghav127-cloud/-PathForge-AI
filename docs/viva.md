# Viva Q&A bank — ADSA + engineering decisions

## Algorithms

- **Dijkstra, why correct here?** Non-negative arc costs (validated;
  negatives rejected); lazy heap with decrease-key via re-push + stale skip;
  lexicographic `(cost, hops, path)` tie-break shared with A* and Yen.
- **When does your A* equal Dijkstra?** Non-geographic objectives or
  unbounded speed ⇒ h=0, flagged `HEURISTIC_ZERO`, still optimal.
- **What breaks A* admissibility?** A road shorter than straight-line distance
  beyond tolerance (max 100 m, 1% of haversine) ⇒ `HEURISTIC_INADMISSIBLE`,
  no route rather than a wrong route. Integer floors only — never ceil.
- **Yen vs brute force?** `test_yen.cpp` checks Yen against a brute-force
  simple-path oracle on seeded graphs; diversity filter caps shared arcs.
- **Held-Karp limits?** Exact ≤10 stops (`exactUpTo`), nearest-neighbor +
  2-opt above; `optimal` flag tells which; permutation oracle in tests.
- **Prim vs Kruskal agreement?** Both over `distanceM`, roads once, reverse
  duplication folded; forest flag when disconnected; tested equal on seeds.
- **Diversion thresholds?** Recommend iff finite savings ≥ threshold (equality
  recommends — tested); cooldown + signature dedup; dismissal suppresses only
  its own signature; blockage always re-alerts.

## Data structures

Heap (dijkstra/astar/prim), DSU (kruskal), queue/stack (traversal), Kahn
lexicographic topo-sort, Held-Karp bitmask DP, Yen deviation paths, fixed-point
permille weights (no float money/time in the core).

## Engineering

- **Why WASM + stateless ABI?** Deterministic, testable, same binary feeds
  native oracles and the browser; TS can never diverge from engine math.
- **How do you know the UI shows engine truth?** Native-runner oracles in
  E2E assert every displayed number/arc; `verify-all.sh` runs 9 green stages.
- **No teleport?** Accept validates overlay version + position fingerprint
  (`STALE_PLAN` otherwise); candidate starts at the occupied arc by
  construction (`joinRemainder`); E2E asserts the vehicle arc is continuous.
- **Why is coverage below 90% in yen/lab/diversion?** Documented exception:
  those paths are covered at contract + E2E level instead; line-coverage
  report is measured, not gamed (`docs/testing/coverage.md`).
- **Simulated data?** Banner on every page, provenance doc, synthetic
  generator methodology, OSM ODbL note for future real data.

## Numbers to quote

Hero `13080 s / 334257 m / 7 arcs`; jam+closure `16740 s`;
recommendation saving `14484 s ≥ 600 s`; multistop `14737 s` OPTIMAL;
tiny Dijkstra/A* `20 s`; MST `30 m`; bench 4900-node Dijkstra `~2.0 ms`.
