# Decisions (ADRs, newest first)

## ADR-003 (2026-11-02): C++17 mandatory
- Source: explicit user instruction this session
- Decision: engine in C++17; no Java/Python switch
- Status: accepted

## ADR-002 (2026-11-02): Hybrid product (Option C)
- Source: explicit user instruction this session
- Decision: build hybrid navigation simulator + ADSA Laboratory (not A-only or B-only)
- Status: accepted

## ADR-001 (2026-11-02): Repo placement + prompt preservation
- Repo: new `./pathforge-ai` (workspace root was home dir, not a git repo; no unrelated work touched)
- `docs/MASTER_PROMPT.md`: byte-for-byte copy of `/Users/raghavbhardwaj/Desktop/prrrrrr.md` (verified with `cmp`)
- No `docs/SPEC.md`: no separate spec file was supplied
- License: MIT proposed, PENDING C0 approval (ask: university constraints?)
- Status: implemented (M0)

## Standing rules (from master prompt §0)
- Priority: (1) later user instructions; (2) safety/sandbox; (3) prompt decisions; (4) SPEC.md if supplied
- No SPEC.md supplied: provisional ledger derived from master prompt, labeled as such
- Conflicts SPEC-vs-prompt: none (no SPEC); future conflicts logged here, never silent

## ADR-004 (2026-11-02, C0 approvals granted by user)
- Installs APPROVED: brew cmake+ninja, ~/emsdk Emscripten, per-project npm + pinned C++ deps; network use approved
- License APPROVED: MIT
- Autonomy APPROVED: build M1→M12 in verified slices
- Installed: cmake 4.4.5, ninja 1.13.2, emcc 6.0.13 (sdk-releases-eb132757325583b787fe9414b09afea9442b72ad-64bit)

## 2026-11-02 — M6 E2E uses system Chrome via channel:chrome (no browser download); preview server reached over localhost (IPv6) after 127.0.0.1 refused; E2E asserts highlight via read-only cy handle plus rendered step list, never a test double.
