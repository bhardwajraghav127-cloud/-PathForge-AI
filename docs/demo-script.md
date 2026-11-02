# Demo script — viva / C3 rehearsal (follow the app, quote the numbers)

Setup: `cd frontend && npm ci && npm run dev`, open the printed URL.
All numbers below are engine facts reproduced by `e2e/demo.spec.ts`.

## Act 1 — Plan (Route Planner)

1. Dashboard: point at `20 vertices · 42 roads (north-india-sim-v1)`.
2. Route Planner: Find Best Route (Chandigarh → Delhi, FASTEST).
3. Read the facts: 7 arcs `ex01:f…ex07:f`, `13080 s` (3 h 38 min),
   `334257 m`, toll `₹590`, delay `0 s`.
4. View Alternative Routes: 3 Yen alternates (e.g. `alt0: 4 h 5 min`).
5. Why This Route?: deltas vs best + shared-arc counts — all from
   `route.compare`, nothing hand-written.

## Act 2 — Perturb (traffic)

6. Traffic editor: report jam on `ex06` (both) → overlay v2, route recomputed.
7. Close road `ex03` → reroute via `gt01:f…gt04:f`, time rises to `16740 s`;
   map highlight follows the new arcs exactly.

## Act 3 — Compare and optimize

8. Scenarios: save `demo-closed`, Compare → normal / congested / closed rows
   with `Δ +s / +m` deltas from `scenario.compare`.
9. Multi-Stop: Optimize (delhi, chandigarh, karnal, ambala, start delhi) →
   **OPTIMAL** held-karp, order delhi → karnal → ambala → chandigarh,
   `14737 s` (input order is not optimal — guarantee 9).

## Act 4 — Drive (Journey)

10. Journey: Start (per-arc times from `route.evaluate`), vehicle dot moves
    along `ex01:f`, progress % and ETA tick at ≤10 Hz panel rate.
11. Marginal jam → guidance `STAY — CURRENT_IS_BEST` (engine decision).
12. Crawl on `ex04` (10%) → banner `RECOMMEND_DIVERSION`, saving `14484 s`
    ≥ 600 s threshold → Stay (policy persisted), then close `ex04` →
    `REROUTE_REQUIRED` → Accept adopts the candidate from the occupied arc
    (no teleport), history records both decisions.

## Act 5 — Lab and finish

13. Lab: BFS from `a` → order `a → b → c → d`; Dijkstra and A* agree
    (`ab:f bc:f`, 20 s); Prim and Kruskal agree (weight `30 m`).
14. Compare MST_PRIM vs MST_KRUSKAL → cost agreement `true`.
15. Settings → dark theme (persists). Done — zero console errors throughout.

Fallbacks: if a banner does not appear, check the overlay version badge
(every edit bumps it and triggers recompute); Reset on Journey re-arms the
simulator; `journey-reset` is available while running.
