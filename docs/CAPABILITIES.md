# PathForge AI — M0 Capabilities (observed 2026-11-02)

Machine: arm64 Apple Silicon, macOS 27.0.1, SHELL=/bin/zsh
Workspace: /Users/raghavbhardwaj (home dir, NOT a git repo)
Project repo: ./pathforge-ai (new, `main` branch, no commits yet)

## Muse CLI (observed)
- Version: Muse Code 1.4.14 (1.4.14-R7309.1)
- `muse --help`: TUI + subcommands resume/exec/config/export/trace/model-profile/skills/voice/plugins/sandbox/schema/serve/session-message/mcp/auth/login/logout/usage/init
- `muse skills list/inspect/validate/install` verified working (60+ user skills installed earlier this session)
- `muse sandbox`: only `windows check/setup` surfaced on macOS; POSIX sandbox enforced (writes limited to workspace root, /tmp, TMPDIR, git storage)
- Approval mode this session: on (launch policy on-request). One `require_escalated` call was denied later with "approval prompts are disabled" — installs must use default sandbox or explicit user approval.
- Model/version, reasoning mode: UNKNOWN (not exposed by `--version`/`--help`)
- Instruction-file auto-loading (AGENTS.md): UNVERIFIED — AGENTS.md created, loading behavior not confirmed
- Hooks, MCP servers, plugins: UNKNOWN (not probed; `muse mcp`, `muse plugins` exist but not inventoried to avoid side effects)
- Subagents: this orchestration session supports child agents (subagent_spawn/workflow tools). Native Muse CLI independent parallel subagent API: UNKNOWN — to be proven with a trivial CLI-level delegation trial at M1, never assumed.
- Worktree isolation, concurrency limits, context-compaction behavior: UNKNOWN
- Web access: available (web_search + git clone of github.com succeeded this session)

## Toolchain (observed)
- xcode-select: /Library/Developer/CommandLineTools
- clang++: Apple clang 21.0.0 (clang-2100.3.34.2), arm64-apple-darwin27.0.0 — C++17 capable
- git: 2.54.0 (Apple Git-157)
- cmake: NOT FOUND; ninja: NOT FOUND
- python3: 3.14.7; node: v26.10.0; npm: 11.19.1; Homebrew: 7.0.11
- emcc: NOT FOUND (no ~/emsdk observed; not probed beyond PATH)
- Disk: 72Gi avail on /
- Browsers: Google Chrome.app, Safari.app present (execution not yet tested)

## Skills present
- 19 Anthropic-skills + 39 OpenAI curated skills in user scope (incl. `pdf` + `openai-pdf`), plus built-ins (blender, browser-app-delivery, git, plan, python-env, etc.)
- Relevant: no PathForge-specific skills; C++/React/CMake skills not installed

## Gaps for C0
- cmake, ninja, Emscripten needed before M1 native/WASM builds
- GoogleTest, nlohmann/json, Vite/React/Cytoscape/Vitest/Playwright versions pending (offline label until fetched or installed)
