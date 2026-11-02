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
