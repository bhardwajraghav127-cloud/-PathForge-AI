# AGENTS.md — PathForge AI constitution (M0)
<!-- Auto-loading by Muse CLI is UNVERIFIED; if unsupported, follow docs/MASTER_PROMPT.md manually -->

1. Execute docs/MASTER_PROMPT.md; do not re-plan it. C++17 mandatory, hybrid build.
2. Repo root is ./pathforge-ai only. Never touch outside files. No sudo, no curl|sh, no force-push, no secrets.
3. Genuine C++ engine only: no TS pathfinding/diversion decisions; no hardcoded routes, savings, or benchmarks.
4. Small vertical slices: contract → implement → compile → test → review → commit. Keep main green; tag mN-verified only on green gates.
5. VERIFIED only after commands actually pass. Record command+result+date+commit in docs/PROGRESS.md + TRACEABILITY.md.
6. Determinism: canonical arc-ID order, checked int64 math, same input → same semantics native/WASM (volatile fields masked).
7. Engine stateless across requests (ABI pf_execute/pf_free, envelope apiVersion/requestId/ok). TS renders + advances vehicle only.
8. Tests: fix code, never weaken assertions. C++ ≥90% algo lines, TS sim ≥85% or documented exception with approval.
9. Honest metrics + simulated-data notice everywhere (SIMULATED DATA — NOT LIVE GPS OR TRAFFIC).
10. Resume: read AGENTS.md → PROGRESS.md → TRACEABILITY.md → DECISIONS.md → git status/log → run scripts/verify-all.sh. After 3 failed attempts at one cause, switch approach; after 3 approaches, report to user.
11. Map: engine/ (C++), frontend/ (React/TS/worker), tests/, datasets/sample-networks/, docs/, scripts/.
12. Current: M0 discovery/bootstrap. Next: C0 approval → installs → M1 slices.
