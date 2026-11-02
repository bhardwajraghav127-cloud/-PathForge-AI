# PathForge AI 2.0 — 2-minute faculty demo script

Setup: `cd pathforge-ai/frontend && npm run preview -- --port 8471 --strictPort`,
open http://localhost:8471/#/demo in Chrome. Enable Presenter mode on the
demo page for larger type. Everything below is simulated; say so once upfront.

## Act 1 — Smart Demo (90 seconds)

1. Click **Start Smart Demo** (guided mode preselected, 600×).
   Say: "One click. The C++ engine plans the fastest Chandigarh–Delhi route
   plus two genuine Yen alternatives — times, tolls, deltas on screen."
2. Watch the vehicle leave with the trail and S/F flags; narrator tracks stages.
   Say: "Durations come from per-arc engine evaluations, not animation timing."
3. The SIMULATED closure hits ex03 ahead; the sim pauses at Decide.
   Say: "A closure on our own future route. The diversion policy recomputed
   from our exact position: REROUTE_REQUIRED, blocked current plan, and a
   recommended ETA. Nothing here is scripted except the incident location."
4. Click **Accept Diversion**.
   Say: "No teleport — we resume mid-arc on the engine-returned plan."
5. Open the **Decision receipt**, then **Why This Route?**.
   Say: "Overlay version, policy reason, estimate, my action. Edge-by-edge
   costs sum exactly to the engine total — the drawer proves the match."

## Act 2 — Fleet (45 seconds)

1. Open **Fleet**, click **Start Fleet** (5 vehicles, 60×).
   Say: "Five independent vehicles, one shared overlay, one engine."
2. Click **Major Closure**.
   Say: "ex04 closes. Watch: corridor vehicles get decisions, the western
   vehicles don't blink, and the vehicle already on ex04 finishes its arc —
   the policy decides per vehicle."
3. Point at KPIs + event feed.
   Say: "Remaining time, affected count, reroutes — all sums over live
   per-vehicle engine facts."

## Act 3 — Evidence (25 seconds)

1. Open **Algorithm Lab**, run Dijkstra, step the trace.
   Say: "Authentic engine trace events — visit, discover, relax — and the
   MST agreement check."
2. If asked about ML: "There is none claimed. This is classical
   algorithms + a decision policy over simulated data."
