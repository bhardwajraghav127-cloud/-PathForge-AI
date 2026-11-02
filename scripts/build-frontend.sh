#!/usr/bin/env bash
# Frontend typecheck + production build (offline-safe after npm install).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"
if [ ! -d node_modules ]; then npm ci 2>&1 | tail -n 2; fi
npm run build 2>&1 | tail -n 6
