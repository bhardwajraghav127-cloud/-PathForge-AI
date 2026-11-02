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

## 2026-11-02 — AC-09..AC-11 + attribution green (2 passed)

Suite: `frontend/e2e/traffic.spec.ts`. Oracle: native runner with the identical
overlay payload the UI sends.

- AC-09: jam incident `i1` reported on ex06 (both); road ex03 closed.
  Overlay shows `v3 · 1 incident(s) · 0 factor(s) · 1 closure(s)`.
- AC-10: overlay version v2 → v3 across edits; route time rises
  13080 s → 16740 s under the jam+closure overlay (effective weights updated).
- AC-11: the same Find inputs auto-recompute on each traffic edit; the
  outcome changes 7 arcs (`ex01:f…ex07:f`) → 8 arcs
  (`gt01:f gt02:f gt03:f gt04:f ex04:f ex05:f ex06:f ex07:f`) — metamorphic proof
  that the traffic change caused the recalculation.
- Attribution (`why-best`): best-route incident list contains `i1`
  (jam on ex06, an arc the route still traverses).
- Alternatives: 3 engine alternatives listed; selecting `alt0` displays its
  engine facts (17126 s); map highlight follows the displayed plan.
- Zero console/page errors across the flow.

## 2026-11-02 — AC-07,08,12,14,15,16 journey green (29 s wall)

Suite: `frontend/e2e/journey.spec.ts`. Oracle: native runner fed the exact
banner-frozen position and overlay.

- AC-07: Start Journey begins a run (per-arc durations from route.evaluate).
- AC-08: vehicle holds `ex01:f` while fracPermille rises (directed, no jumps).
- AC-12 marginal: jam `i1` on ex06 → guidance `STAY — CURRENT_IS_BEST`, no banner.
- AC-12 major: ex04 at 10% speed → `RECOMMEND_DIVERSION — THRESHOLD_MET`,
  banner saving 14484 s == oracle saving (threshold 600 s).
- AC-14: Stay dismisses via engine reject (policy persisted), history shows
  `stay`; closing ex04 → `REROUTE_REQUIRED` (new signature bypasses dismissal);
  Accept adopts the engine-validated candidate; history shows `accept`;
  localStorage `pf-decision-history` validates as [{stay},{accept}].
- AC-15: after accept the vehicle still reports the frozen occupied arc;
  map highlight equals exactly the oracle candidate arcs (starts at occupied arc).
- AC-16: summary shows chandigarh → delhi, planned/actual times, arcs
  traversed, accepts ≥ 1, stays ≥ 1.
- Zero console/page errors across the flow.

## 2026-11-02 — AC-17,18 green (5/5 e2e with M6-M8)

- AC-18 (`e2e/multistop.spec.ts`): stops delhi/chandigarh/karnal/ambala,
  start delhi → engine OPTIMAL held-karp order differs from input; UI order,
  totals (14737 s, 297711 m, toll 310) and all leg arcs equal the oracle.
- AC-17 (`e2e/scenarios.spec.ts`): snapshots congested (jam ex06, overlay v2)
  and closed (+closure ex03, overlay v3) stay isolated (v2 text unchanged after
  the closure edit); compare rows and Δ time/distance equal the oracle for
  normal/congested/closed; `pf-scenarios` persists 2 validated entries.
