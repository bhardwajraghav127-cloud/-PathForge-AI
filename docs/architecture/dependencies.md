# Dependencies (M0 provisional — versions pending approval/network)

## C++ engine
- nlohmann/json (MIT, pinned, vendored or FetchContent + SHA) — engine JSON I/O
- GoogleTest (BSD-3, pinned) — test-only, never shipped in prod bundle

## Frontend (all pinned in package-lock.json at M1/M6)
- React + TypeScript (strict), Vite (static SPA), Cytoscape.js (preset layout, no map tiles)
- Zustand (stores), React Router HashRouter (static deploy), Tailwind (themes)
- Zod (runtime validation of engine JSON + localStorage schemas)
- Vitest + React Testing Library (unit), Playwright (E2E from M6)
- Radix/lucide: ONLY if M6 dependency review approves (permissive license, needed value)

## Build
- CMake presets, clang-format, Emscripten (version pinned post-C0)
- No runtime CDN, no map tiles, no telemetry, no secrets

## Provenance ledger (fill at install time)
| Dep | Version | License | Source | Rationale |
|-----|---------|---------|--------|-----------|
| cmake | TBD | BSD-3 | brew | native builds |
| ninja | TBD | Apache-2 | brew | fast builds |
| emsdk | TBD | MIT/Apache | github.com/emscripten-core/emsdk | WASM builds |
| nlohmann/json | TBD | MIT | vendored | engine JSON |
| googletest | TBD | BSD-3 | pinned | C++ tests |
| vite/react/cytoscape/etc | TBD | MIT | npm lockfile | UI |
