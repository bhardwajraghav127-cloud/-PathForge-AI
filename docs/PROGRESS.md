# Progress (append-only, newest first)

## 2026-11-02 — M0 discovery + repo bootstrap (IN_PROGRESS)
- Branch: main (fresh `git init`, no commits yet)
- Ran: pwd, ls -la, git status (not-a-repo at home), uname -m (arm64), sw_vers (27.0.1), xcode-select -p, clang++ --version (21.0.0), git --version (2.54.0), cmake/ninja/emcc (all missing), python3/node/npm/brew versions, disk (72Gi avail), muse --help/--version/skills, browser inventory (Chrome+Safari)
- Created ./pathforge-ai with engine/frontend/tests/datasets/docs/scripts; copied master prompt byte-for-byte (cmp OK); git init done
- Last green commit: none yet (M0 docs uncommitted)
- Next 5: (1) finish M0 docs + .gitignore + AGENTS.md; (2) initial commit; (3) present C0 + get approvals; (4) installs per approval; (5) begin M1 slices
- Blockers: cmake/ninja/emsdk missing; network + license approvals pending C0

## Legend
- M<n> milestone, C<n> checkpoint; VERIFIED only after commands actually pass

## 2026-11-02 — M1 engine + WASM + shell (DONE, gate green)
- Built: engine (graph/heap/dijkstra/envelope/ABI/contract-runner), 6 fixtures, 6 scripts, contract doc, Vite/React/TS shell + EngineClient + worker
- Commands: build-engine-native.sh OK; test-engine.sh 13/13 pass; build-wasm.sh OK (em++ fix for C++ link); test-contract.sh 6/6 parity; build-frontend.sh OK; verify-all.sh all PASS
- Browser smoke: real-time CDP on headless Chrome → engine.info build:wasm rendered (virtual-time dump-dom stalls workers; documented, not an app bug)
- Fixes: CMakePresets moved into engine/; test arg bug; ABI extern decls; emcc→em++ link
- Next 5: M2 graph validators/heap/BFS/DFS/A*/objectives/traffic/position-route; sanitizer preset; ≥40-fixture growth; dataset design; lab trace schema
- Blockers: none for M2

## 2026-11-02 — M2 slices 1-3 (DONE, gate green)
- Objectives: LOWEST_TOLL lex Dijkstra, AVOID_CONGESTION penalties + avoidSevere, BALANCED fixed-point + scales; 4 unit tests
- Traversal: BFS/DFS + capped traces; A* admissible haversine (+epsilon guards), zero-speed fallback; lab.run M2 subset; 2 focused fixes (test coords, error precedence) with maintained coverage
- Position: mid-arc source, crawl policy, route.evaluate, shared evaluatePlan; ceiling remainders, no double-count
- Evidence: 31/31 gtest, 31/31 ASan+UBSan, 15/15 native<->WASM parity, verify-all all PASS
- Fixes: build-wasm.sh now compiles all engine sources (was M1 subset)
- Next 5: M3 dataset + guarantees; Yen alternatives; incidents overlay; route.compare; scenario.compare

## 2026-11-02 — M3 (DONE, gate green)
- Incidents: directional stable-ID effects (min factor, summed delays, closure wins); per-arc attribution; validation
- Yen K-shortest loopless paths + diversity filter + route.alternatives; brute-force oracle agreement
- route.compare (computed deltas, shared/unique arcs, incident attribution); scenario.compare (immutable overlays, shared solveRoute)
- Dataset north-india-sim-v1 (20v/42r, 3 corridors, 4 one-ways, 4 parallel pairs, Jind leaf) + marginal/major presets + provenance; 9/9 guarantees green
- Evidence: 46/46 gtest, 46/46 ASan+UBSan, 20/20 parity, verify-all all PASS
- Next 5: M4 diversion engine + notification policy + presets; engine.info commands refresh; docs update; commit M3

## 2026-11-02 — M4 (DONE, gate green)
- Diversion engine: stateless assessment + notification policy + accept/reject
  actions (STALE_PLAN gates); same solver/convention as route.find
- Fixes: intended-destination routing for blocked plans; already-there branch
- Tests: 8 Diversion suites incl. threshold equality, cooldown/material/
  dismissal, blocked variants, accept staleness, dataset marginal-STAY /
  major-RECOMMEND end-to-end (54/54 gtest, 54/54 sanitizer, 23/23 parity)

## 2026-11-02 — M6 (DONE, gate green)
- UI: design tokens (light/dark, WCAG-conscious solids), Dashboard, Route Planner
  (shared MapWorkspace: Cytoscape equirectangular map + planner panel), Settings
  theme toggle; Journey/Multi-Stop/Scenarios/Lab honest M8-M10 placeholders
- Map: preset layout, bezier parallel-edge separation, route class highlights
  exact engine arc IDs; `window.__PF_DEBUG__.cy` read-only handle for E2E
- E2E AC-01..AC-06 (Playwright, system Chrome, prod preview): native-runner
  oracle agrees on 7 arcs + distance/time/toll/delay; zero console errors
- Evidence: 63/63 gtest, 63/63 sanitizer, 32/32 parity, e2e 1/1, verify-all all PASS
- Next: M7 traffic editor + incidents + alternatives + explanations (AC-09..11)

## 2026-11-02 — M7 (DONE, gate green)
- Traffic store (versioned overlay: incidents/factors/closures) + TrafficPanel
  editor; overlay flows into route.find/alternatives/compare; auto-recompute
- Alternatives (Yen ≤3) selectable with map-follow; Why This Route? from
  route.compare deltas + incidentIds attribution + shared arcs
- Fixed zustand object-selector infinite render loop (React #185); E2E uses
  scalar selectors pattern going forward
- Evidence: e2e 2/2 (jam i1 on ex06 + ex03 closure → 13080s→16740s, 7→8 arcs,
  attribution contains i1); verify-all 7 stages PASS

## 2026-11-02 — M8 (DONE, gate green)
- Journey Simulator page: Start/Pause/Resume/Reset, 1/10/60/600× speeds,
  per-arc durations from route.evaluate, rAF vehicle overlay (rendered-position
  interpolation, panel mirrors ≤10 Hz), diversion checks on 60 sim-s cadence +
  traffic edits, pause-on-banner, accept (engine-validated adopt, no teleport)
  / stay (engine reject, policy persisted), summary + persisted decision history
- Evidence: e2e 3/3 (incl. 29 s full journey), verify-all 7 stages PASS

## 2026-11-02 — M9 (DONE, gate green)
- Multi-Stop Planner: stop list editor (add/reorder/remove, start/end pins),
  route.multistop optimize, OPTIMAL/method badge, leg facts, map-follow
- Scenario Comparison: immutable traffic snapshots + localStorage persistence,
  scenario.compare across normal/saved, delta display
- Evidence: e2e 5/5, verify-all 7 stages PASS
