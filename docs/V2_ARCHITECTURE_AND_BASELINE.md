# PathForge AI 2.0 — architecture & baseline (V0)

Branch: `fleet-2.0` (from `ui-redesign` @ `9b8cafa`, clean tree).
Prior claims rechecked, not trusted: all reproduced below.

## Baseline verification (2026-11-02, before V2 edits)

| Gate | Result |
|---|---|
| `verify-all.sh` 9 stages | PASS (native-build, unit-tests, sanitizer, wasm-build, contract-parity, frontend-build, e2e, bench, antifake) |
| gtest native | 65/65 (`engine/build/native-release/pf_tests`) |
| gtest sanitizer | 65/65 (`engine/build/native-sanitizer/pf_tests`) |
| contract parity native↔WASM | 32/32 |
| Playwright E2E | 16/16 |

## Existing data flow (reused as-is)

```
React page → EngineClient.call(command, payload, {channel})
  → Web Worker (engine.worker.ts) → WASM pf_execute(JSON)
  → C++ engine (route.find / route.alternatives / route.evaluate /
     diversion.evaluate / lab.run / scenario.compare / ...)
  → JSON result → Zod validation → Zustand store → render
```

Stale responses suppressed per channel; worker crash auto-recovers once.
No pathfinding in TypeScript (antifake gate enforces).

## Reusable components

- `frontend/src/engine/EngineClient.ts` — typed calls, channels, timeouts.
- `frontend/src/data/dataset.ts` — `networkPayload()`, formatters, 20 vertices / 42 roads.
- `frontend/src/traffic.ts` — versioned overlay store (incidents/factors/closures), `overlay()` payload builder.
- `frontend/src/simulation.ts` — journey sim store pattern (durations/distances/pos/banner/policy/history/summary).
- `frontend/src/pages/Journey.tsx` — proven rAF loop: engine-evaluated arc durations, diversion checks, accept/reject via `diversion.evaluate`, no-teleport continuity.
- `frontend/src/components/MapView.tsx` — Cytoscape map, `routeArcIds`/`altArcIds` classes, `cyOut` handle, overlays via `renderedPosition()`.
- `engine/.../diversion.*` — stateless policy: STAY / RECOMMEND_DIVERSION / REROUTE_REQUIRED / NO_ROUTE_AVAILABLE, cooldowns, dismissals, accept validation.
- E2E oracle pattern: native `pf_contract_runner` as independent oracle.

## Gaps V2 must fill

1. No scripted one-click demo (Journey needs manual plan + manual incident).
2. No multi-vehicle simulation (single `useSim` + single vehicle overlay).
3. No per-edge cost explanation drawer or decision receipts.
4. No presenter/viva overlay.
5. Disclaimer says `SIMULATED DATA — NOT LIVE GPS OR TRAFFIC`; V2 banner must read `SIMULATION — NOT LIVE GPS, DISPATCH OR TRAFFIC`.

## V2 plan (no C++ changes anticipated)

All new behavior orchestrates existing engine commands (`route.find`,
`route.alternatives`, `route.evaluate`, `diversion.evaluate`). New code is
frontend-only: `src/demo/` (Smart Demo FSM + scenario), `src/fleet/`
(multi-vehicle sim + dashboard), `src/explain/` (Why-drawer + receipts),
new pages + nav, new E2E specs. Each vehicle keeps independent
position/clock/route/history; one shared overlay; engine calls only on
events (never per animation frame); overlay/version/position fingerprinting
on every diversion response.
