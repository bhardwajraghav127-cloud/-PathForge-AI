#!/usr/bin/env bash
# Browser E2E (mandatory from M6): Playwright AC suite against the production
# preview server + real WASM engine. Requires dist/ (frontend-build) and the
# native runner (native-build) for the independent oracle.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"
npx playwright test
