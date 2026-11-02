# PathForge AI 2.0 — test report (V7)

Branch `fleet-2.0`. Every count below was executed, not inferred.

## Full gate: `bash scripts/verify-all.sh` — 9/9 PASS

| Stage | Result |
|---|---|
| native-build | PASS |
| unit-tests | 65/65 PASS |
| sanitizer (ASan+UBSan) | 65/65 PASS |
| wasm-build | PASS |
| contract-parity | 32/32 PASS (native↔WASM byte-identical, masked metadata) |
| frontend-build (`tsc` + `vite build`) | PASS |
| e2e (`npx playwright test`) | 32/32 PASS |
| bench | PASS |
| antifake (no TS pathfinding) | PASS |

## E2E breakdown (32 total)

- 16 pre-existing specs (route, journey, traffic, multistop, scenarios,
  lab, demo, a11y, redesign, screenshots): all green, unmodified
  assertions — full regression preserved.
- `e2e/smart-demo.spec.ts` (3): accept path with receipt + summary +
  continuity probes; stay path; guided pace + narration.
- `e2e/fleet.spec.ts` (6): 5-vehicle independence; incident relevance
  (only V1 notified); major closure multi-affect incl. occupied-arc
  stay; genuine NO_ROUTE blocked (rohtak→jind + wr10); full completion
  with KPI reconcile; pause/resume/add/remove/reset + traffic cleanup.
- `e2e/explain.spec.ts` (5): edge sums equal engine totals (exact
  string compare of seconds + metres); demo + fleet receipts pin
  overlay v3, policy, action; viva toggle; emergency preset.
- `e2e/v2-mobile.spec.ts` (2): demo + fleet flows at 390×844.

## Other checks
- `npm audit --omit=dev`: 0 vulnerabilities.
- Engine probes (native runner): fleet pairs reachable, ex03 closure →
  REROUTE_REQUIRED, wr10 closure on jind run → NO_ROUTE_AVAILABLE,
  per-arc sums == route totals (13080 s / 334257 m).
- Screenshots `docs/screenshots/{demo,fleet,fleet-incident}.png` captured
  from real runs and visually reviewed.

## Known limitations
- Coverage gaps unchanged from v1.0.0 (engine untouched by V2).
- Fleet periodic diversion checks run every 180 sim-s per vehicle; a
  decision can lag a fast vehicle at 3600× by a few seconds of wall time.
- Preview server is session-bound (macOS, no setsid detachment).
