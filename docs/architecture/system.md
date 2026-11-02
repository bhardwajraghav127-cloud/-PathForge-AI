# System diagram (M12)

```mermaid
flowchart TB
  subgraph UI [React + TypeScript — renders only]
    Pages[Pages: Dashboard, Route, Journey, MultiStop, Scenarios, Lab, Settings]
    Stores[Zustand stores: settings, network, route, traffic, sim, scenarios]
    Map[Cytoscape MapView — preset equirectangular, engine-class highlights]
    Client[EngineClient — typed calls, channels, stale suppression, recovery]
  end
  subgraph Bridge [Worker boundary]
    Worker[engine.worker — no routing math]
    Wasm[WASM module — pf_execute / pf_free]
  end
  subgraph Engine [C++17 — decides everything]
    API[ABI: engine.info, network.validate, route.*, lab.*, scenario.compare, diversion.evaluate]
    Core[Dijkstra / A* / Yen / Held-Karp / Prim+DSU / Kahn / diversion policy]
    Data[(north-india-sim-v1: 20v/42r)]
  end
  subgraph Gates [Evidence]
    GTest[65/65 gtest + ASan/UBSan]
    Parity[32/32 native↔WASM parity]
    E2E[10/10 Playwright E2E, native oracle]
    Bench[seeded benchmarks + coverage]
  end
  Pages --> Stores --> Client --> Worker --> Wasm --> API --> Core
  Map -. highlights .-> Core
  Core --> Data
  Core ==> GTest & Parity & E2E & Bench
```

Request flow: page → store action → `EngineClient.call(command, payload)`
→ worker `pf_execute` → JSON envelope back → Zod validation → store facts →
render. Traffic edits bump the overlay version; Journey and Route panels
recompute automatically. Diversion checks run on a 60 sim-s cadence plus
every version bump; proposals pause the sim until Accept/Stay.
