# Cross-language contract (M1)

## Envelope
Request: `{"apiVersion":1,"requestId":"r-17","command":"route.find","payload":{}}`
Success: `{"apiVersion":1,"requestId":"r-17","ok":true,"result":{},"stats":{}}`
Failure: `{"apiVersion":1,"requestId":"r-17","ok":false,"error":{"code":"...","message":"...","details":{}}}`

Every request carries its full network snapshot + overlay. The engine is
stateless; no mutable graph state between requests.

## M1 commands
- `engine.info` → `{engine, version, apiVersion, build, commands[]}`
- `network.validate` → `{valid, issues[{code,message}]}` (payload: `{network}`)
- `route.find` → route or `{found:false,reason:"UNREACHABLE"}`
  (payload: `{network, overlay?, source, target, objective: FASTEST|SHORTEST, algorithm: DIJKSTRA}`).
  A_STAR and further objectives arrive in M2; requesting them returns
  `INTERNAL_ERROR` documenting the M1 boundary (not a routing fact).

## M1 error codes
`INVALID_JSON, UNSUPPORTED_API_VERSION, SCHEMA_VIOLATION, UNKNOWN_VERTEX, LIMIT_EXCEEDED, INTERNAL_ERROR`
(M2+ adds UNKNOWN_ROAD, NEGATIVE_WEIGHT, HEURISTIC_INADMISSIBLE,
INVALID_POSITION, STALE_PLAN, INCOMPATIBLE_COMPARISON + warnings.)

## Volatile vs semantic fields
Volatile (masked in parity): `stats.elapsedUs`, `result.build`.
Semantic (must agree native↔WASM): paths, costs, IDs, ordering, errors.

## C ABI (`engine/src/bindings/abi.cpp`)
`char* pf_execute(const char* request_json)` — malloc'd UTF-8 response, freed
exactly once via `pf_free`. Null input → null. Requests over 4MiB →
LIMIT_EXCEEDED. All C++ exceptions contained. Tested in `test_envelope.cpp`.

## WASM flags (emcc 6.0.13, validated)
`em++ -std=c++17 -O2 -DPF_BUILD_WASM=1 -sMODULARIZE=1 -sEXPORT_ES6=1
-sENVIRONMENT=worker,node -sALLOW_MEMORY_GROWTH=1` with explicit UTF-8 runtime
methods. No pthreads, no COOP/COEP requirement.

## Fixtures
`tests/contract/fixtures/*.request.json` (6 at M1; ≥40 at M5). Parity runner:
`scripts/test-contract.sh` (native runner vs Node WASM harness, semantic diff).
