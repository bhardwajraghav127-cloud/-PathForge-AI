# Acceptance evidence (M6)

Suite: `frontend/e2e/route-planner.spec.ts` (Playwright, system Chrome, headless)
App: `vite preview` production build. Engine: real WASM module (C++17).
Oracle: native `pf_contract_runner` binary fed the identical payload the UI sends.

## 2026-11-02 — AC-01..AC-06 green (1 passed, 1.5 s wall)

- AC-01: `/#route` loads; zero `pageerror` and zero console `error` entries across
  the full flow (including a favicon, so no 404 noise).
- AC-02: dashboard renders `Network: 20 vertices · 42 roads (north-india-sim-v1)`.
- AC-03: typing `delh` in Destination offers `Delhi (delhi)`; selecting shows
  `Selected: Delhi`.
- AC-04: Find Best Route (chandigarh → delhi, FASTEST) returns a connected route.
  Oracle and UI agree on all 7 arcs:
  `ex01:f ex02:f ex03:f ex04:f ex05:f ex06:f ex07:f`
  (chandigarh→zirakpur→rajpura→karnal→panipat→samalkha→sonipat→delhi).
- AC-05: `cy.edges('.route')` ids equal exactly the 7 returned arc IDs.
- AC-06: rendered facts equal oracle facts: distance `(334257 m)`,
  time `(13080 s)`, toll `(590)`, traffic delay `(0 s)`.

Raw facts (oracle, chandigarh → delhi FASTEST): distanceM=334257,
baselineTimeS=13080, timeS=13080, delayS=0, tollInr=590, 7 arcs.
