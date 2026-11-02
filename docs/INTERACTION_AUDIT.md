# U8 interaction, responsive & accessibility audit

Every control below was clicked through in code review; each acts on real
state and gives visible feedback (result render, toast, chip, or dialog).

## Controls act and feed back

| Area | Controls | Feedback |
|---|---|---|
| Shell | nav toggle, theme toggle, nav links, skip link | drawer, `data-theme`, route, focus jump |
| Route planner | find, swap, tabs, save/apply/remove place, alt select, why toggle, report/close/factor/clear, clear-all | route render + toast, compare table, overlay version + toast, confirm dialog |
| Journey | start/pause/resume/stop/reset, follow, scrub, speed, accept/stay, decision revisit | progress bar, ETA, banner, trail, timeline, summary |
| Multi-stop | add/up/down/remove, optimize, drop-last, reset, save/load/delete tour | leg list, numbered markers, confirm dialog, toasts |
| Scenarios | save/compare/load/duplicate/delete/export/preview/expand, map preview | cards, delta chart, diff rows, arcs, confirm dialog |
| Lab | run/play/pause/prev/next/reset, speed, algo/source/target, compare/swap/load, editor examples/add/del/weights/validate | trace list, live stats, frontier highlight, validation message, compare table |
| Map | zoom/fit/center/rotate/expand, views, keyboard, search, city/road inspectors | viewport, chips, drawers, stats chip |

Destructive actions with `Confirm`: scenario delete, tour delete, traffic
clear-all. Low-stakes single-item removals (place, incident) use toasts.

## Responsive

- `≥1280px`: full workspace (map 520px + panel).
- `≤1024px`: panel stacks below map; panel toggle collapses it.
- `≤768px`: nav becomes drawer; map 380px; drawers are bottom sheets.
- `≤390px`: compact header, single-column facts, 320px map.
- `pointer: coarse`: 44px touch targets for small buttons, chips, tabs.

## Accessibility (WCAG 2.2 AA targets)

- Skip link to `#main`; landmarks header/nav/main; drawers are dialogs.
- Focus-visible 3px outline on all interactive elements.
- Toasts and journey progress use `aria-live`; alerts use `role=alert`.
- All inputs labelled; sliders and scrubbers named; tabs are buttons.
- Map canvas has label + full text equivalents (steps, trace, segments).
- Stop markers exposed as a labelled list; contrast-fixed chip colors.
- `prefers-reduced-motion` disables animation and the motion trail.
- Keyboard: full map shortcut set (`?` lists them), Esc closes drawers.
