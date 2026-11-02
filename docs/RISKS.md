# Risks (M0 — likelihood/impact/mitigation)

1. Emscripten Worker/Vite/WASM parity — M/H — minimal round trip at M1, semantic (not byte) fixtures
2. Toolchain install/sandbox/network perms — H/M — one consolidated C0 approval, user-space installs only
3. A* admissibility on approximate geo data — M/H — plausibility checks + HEURISTIC_INADMISSIBLE + seeded oracle tests
4. Integer overflow/balanced-objective precision — M/H — checked/saturating int64, documented scales
5. Equal-cost tie-break determinism — M/M — canonical arc-ID order, global path tie-break tests
6. Mid-arc rerouting/teleport/closure semantics — M/H — partialLeadingArc + crawl policy + boundary tests
7. Yen multigraph diversity — M/M — canonical ordering, dedup, bounded search
8. Diversion cooldown/stale-accept — M/M — stateless engine + policy-state tests
9. Asymmetric TSP heuristics — M/M — directed closure, exact-vs-heuristic oracles
10. Cytoscape parallel edges/animation/a11y — M/M — preset projection, overlay vehicle, reduced-motion
11. Subagent conflicts/context exhaustion — M/M — sequential fallback, no overlapping edits, small slices
12. Viva defensibility — M/H — readable code, per-algorithm docs, ≥60 Q&As, demo script
13. Missing cmake/ninja/emsdk (observed) — H/M — C0 install approval path
