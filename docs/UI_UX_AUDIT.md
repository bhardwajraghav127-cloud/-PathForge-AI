# UI/UX audit — baseline `v1.0.0` (branch `ui-redesign`)

Date: 2026-11-02. Baseline gate (this branch, before edits): native-build,
unit-tests (65/65), sanitizer (65/65), wasm-build, contract-parity (32/32),
frontend-build, e2e (10/10), bench, antifake — all PASS. E2E runs against the
live preview server when present (`reuseExistingServer` unless `CI` is set).

## Observed issues and root causes

1. **Tiny/compressed map (prompt screenshots predate M12 fixes).**
   Diagnosed in `MapView.tsx` history: no `cy.fit()` call, `minZoom: 0.2`
   clamping the required ~0.03 fit zoom, and CSS `var()` colors that canvas
   cannot resolve (route highlight invisible). M12 already fixed those three;
   v1.0.0 renders a fitted, highlighted network. Remaining gaps: 11px node
   labels, 14-unit nodes, no zoom/pan controls, no inspectors, no legend,
   cy instance recreated on theme change (viewport lost), no ResizeObserver
   refit, tall geographic aspect leaves side whitespace (inherent, needs a
   second exploration view).
2. **Near-empty Dashboard** (`pages.tsx`): renders only vertex/road counts
   and a link. Root cause: M6 scoped it as a placeholder; all needed state
   already exists in `store.ts`/`traffic.ts`/`simulation.ts` but is not
   surfaced or shared into actions.
3. **Typography below readability targets**: header 17px, cards 14px,
   labels/meta 12px, map labels 11px. Targets: headings 28–36, section
   18–24, body 15–16, labels 14–16, metrics 24–36.
4. **Tiny vehicle**: 14px dot (`Journey.tsx`); no direction, trail, or
   follow mode. Progress is text-only.
5. **Form-heavy pages**: native selects/inputs everywhere; no search, cards,
   tabs, toasts, dialogs, or confirmations for destructive edits (incident/
   scenario removal). No toast/notification system exists.
6. **Map is display-only**: no click-to-inspect (city/road), no O/D/stop
   markers, no alternative-route differentiation, no traffic/closure edge
   coloring, no legend. Engine arc IDs exist on every edge (`{roadId}:f/r`)
   but are never surfaced visually.
7. **Lab is list-centric**: trace events render as text; no frontier/relaxed
   visual states; graph editor is add-only (no delete vertex/edge, no weight
   edit, no example loader); no Previous/speed/playback controls beyond
   Play/Reset/slider; no per-algorithm complexity/invariant panel.
8. **Responsive gaps**: one breakpoint (900px); no collapsible panel,
   bottom sheet, or 44px touch targets; nav wraps but is not collapsible.
9. **Journey summary distance is 0**: `Journey.tsx` hardcodes
   `distanceM: 0` in the summary (never computed). Must come from
   `route.evaluate` on the adopted plan. (Real defect found in audit.)
10. **E2E config friction**: `reuseExistingServer: false` fails when a dev
    server is already up. Fixed in U0 (reuse unless `CI`).

## Fix plan (maps to U1–U10)

- U1: token scale per §2 targets, component library (buttons, cards, chips,
  toasts, dialogs, drawers, legends, metrics, tabs, searchable select).
- U2: map controller (no per-state recreation; theme via `cy.style()`),
  geographic-schematic + network-exploration views, zoom/fit/center/expand
  controls, ResizeObserver, O/D/stop markers, inspectors, legend, traffic
  edge colors with non-color encodings, collision-aware labels + halos.
- U3–U7: Dashboard command center; planner/journey/multistop/scenario/lab
  rebuilds on shared state; fix summary `distanceM` via engine.
- U8: interaction audit (every control acts + feeds back), toasts, confirms,
  responsive shells, WCAG 2.2 AA pass.
- U9: extend E2E (map controls, inspectors, dashboard, lab editor/playback,
  keyboard, viewports), remeasure coverage, parity, audit, visual QA.
- U10: docs, screenshots, final report.

## Risks

- Cytoscape viewport vs React state: preserve user zoom across recomputes
  (only refit on explicit command or network change).
- E2E churn: existing specs assert current DOM/testids; redesign must update
  specs in lockstep without weakening assertions.
- Scope: U7 lab editor + U2 dual views are the largest builds; sequence them
  before U8 polish.

## Acceptance evidence

This file + branch `ui-redesign` + baseline gate above + per-phase commits.
Final checklist in §16 of the transformation prompt, evidenced in the U9/U10
report.
