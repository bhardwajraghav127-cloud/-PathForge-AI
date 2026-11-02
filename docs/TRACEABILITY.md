# Traceability (M0 provisional ledger derived from master prompt; no SPEC.md supplied)

Status: NOT_STARTED | IN_PROGRESS | VERIFIED | DEFERRED_APPROVED. Evidence required for VERIFIED.

| ID | Requirement | Source | MS | Owner | Status | Evidence | Commit |
|----|-------------|--------|----|-------|--------|----------|--------|
| REQ-01 | Premium responsive dashboard + network map | §1.1 | M6 | A3 | VERIFIED | docs/testing/acceptance-evidence.md | M6 |
| REQ-02 | Fastest vs shortest route | §1.2 | M2 | A2 | NOT_STARTED | — | — |
| REQ-03 | Up to 3 distinct alternatives | §1.3 | M3 | A2 | NOT_STARTED | — | — |
| REQ-04 | Distance/ETA/toll/congestion comparison | §1.4 | M3 | A2/A3 | NOT_STARTED | — | — |
| REQ-05 | 5 objectives (fastest/shortest/toll/avoid/balanced) | §1.5 | M2 | A2 | NOT_STARTED | — | — |
| REQ-06 | Congestion/condition simulation | §1.6 | M7 | A3 | NOT_STARTED | — | — |
| REQ-07 | Accidents/construction/restrictions/jams/closures | §1.7 | M3 | A2 | NOT_STARTED | — | — |
| REQ-08 | Recalc after network/traffic change | §1.8 | M4 | A2 | NOT_STARTED | — | — |
| REQ-09 | Savings-threshold diversion | §1.9 | M4 | A2 | NOT_STARTED | — | — |
| REQ-10 | Cooldown + dedup + stability | §1.10 | M4 | A2 | NOT_STARTED | — | — |
| REQ-11 | Explainable decisions from engine facts | §1.11 | M7 | A3 | NOT_STARTED | — | — |
| REQ-12 | Vehicle start/pause/resume/stop/reset/speed | §1.12 | M8 | A4 | NOT_STARTED | — | — |
| REQ-13 | Position/next-road/remaining/ETA | §1.13 | M8 | A4 | NOT_STARTED | — | — |
| REQ-14 | Mid-arc + directed rerouting, no teleport | §1.14 | M8 | A2/A4 | NOT_STARTED | — | — |
| REQ-15 | Accept/reject + history + summary | §1.15 | M8 | A3 | NOT_STARTED | — | — |
| REQ-16 | Multi-stop exact ≤10 (≤12 opt-in) + heuristic | §1.16 | M5 | A2 | NOT_STARTED | — | — |
| REQ-17 | What-if scenarios + comparison | §1.17 | M5/M9 | A3 | NOT_STARTED | — | — |
| REQ-18 | Graph editor + validation | §1.18 | M10 | A3 | NOT_STARTED | — | — |
| REQ-19 | ADSA lab BFS/DFS/Dijkstra/A*/Prim/Kruskal+ | §1.19 | M5/M10 | A2 | NOT_STARTED | — | — |
| REQ-20 | Comparisons + measured benchmarks | §1.20 | M5 | A5 | NOT_STARTED | — | — |
| REQ-21 | MST/network visualizations | §1.21 | M10 | A4 | NOT_STARTED | — | — |
| REQ-22 | Tested C++ engine, native↔WASM agreement | §1.22 | M1 | A2/A5 | NOT_STARTED | — | — |
| REQ-23 | Hero demo Chandigarh→Delhi + marginal/major cases | §1 hero | M11 | A6 | NOT_STARTED | — | — |
| REQ-24 | Simulated-data notice + provenance + README | honesty | M11 | A6 | NOT_STARTED | — | — |
| AC-01 | Launch without console errors | §16 | M11 | A5 | VERIFIED | docs/testing/acceptance-evidence.md | M6 |
| AC-02 | Network renders correct counts | §16 | M6 | A5 | VERIFIED | docs/testing/acceptance-evidence.md | M6 |
| AC-03 | Origin/dest select + autocomplete | §16 | M6 | A5 | VERIFIED | docs/testing/acceptance-evidence.md | M6 |
| AC-04 | C++ route valid + cost check | §16 | M6 | A5 | VERIFIED | docs/testing/acceptance-evidence.md | M6 |
| AC-05 | Map highlights exact arc IDs | §16 | M6 | A5 | VERIFIED | docs/testing/acceptance-evidence.md | M6 |
| AC-06 | Displayed numbers = engine facts | §16 | M6 | A5 | VERIFIED | docs/testing/acceptance-evidence.md | M6 |
| AC-07 | Start journey runs | §16 | M8 | A5 | NOT_STARTED | — | — |
| AC-08 | Vehicle on directed arcs, no jumps | §16 | M8 | A5 | NOT_STARTED | — | — |
| AC-09 | Apply congestion + closure | §16 | M7 | A5 | NOT_STARTED | — | — |
| AC-10 | Version + weights update | §16 | M7 | A5 | NOT_STARTED | — | — |
| AC-11 | Recompute on change (metamorphic) | §16 | M7 | A5 | NOT_STARTED | — | — |
| AC-12 | Marginal STAY / major RECOMMEND @10min | §16 | M8 | A5 | NOT_STARTED | — | — |
| AC-13 | Explanations match facts | §16 | M7 | A5 | NOT_STARTED | — | — |
| AC-14 | Accept + Stay persist history | §16 | M8 | A5 | NOT_STARTED | — | — |
| AC-15 | Accept continues without teleport | §16 | M8 | A5 | NOT_STARTED | — | — |
| AC-16 | Summary with required fields | §16 | M8 | A5 | NOT_STARTED | — | — |
| AC-17 | Scenario comparison deltas | §16 | M9 | A5 | NOT_STARTED | — | — |
| AC-18 | Small multi-stop OPTIMAL | §16 | M9 | A5 | NOT_STARTED | — | — |
| AC-19 | Lab BFS/DFS/Dijkstra/A*/Prim/Kruskal | §16 | M10 | A5 | NOT_STARTED | — | — |
| AC-20 | C++ algorithms tested | §16 | M11 | A5 | NOT_STARTED | — | — |
| M0-DOCS | M0 docs + constitution + ledger | §3 | M0 | Orch | IN_PROGRESS | this repo | — |
