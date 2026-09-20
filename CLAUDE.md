# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`resolve-lua-bridge` is an MCP server that lets Claude Desktop control **DaVinci Resolve 21.1 free edition on macOS**. Blackmagic removed Python and external scripting from the free edition in 21.1 and their native MCP server is Studio only. The one remaining door is a Lua script launched from `Workspace > Scripts` inside Resolve, which receives the live `resolve` object. That script runs as a long-lived in-app bridge and executes Lua on behalf of a Python MCP server via a file-based request/response queue.

## Current state (as of 2026-09-20)

- **Greenfield.** No code exists yet. The only file is the mission spec at `docs/claude-code-prompt-resolve-lua-bridge.md`.
- **Not a git repository yet.** The spec requires a commit after each step, so `git init` before the first one.
- The spec is a *baseline plan*, not a finished design. It must be validated against current docs (Step 0) before anything is built.

## The spec is the source of truth

Read `docs/claude-code-prompt-resolve-lua-bridge.md` in full before doing any work. It defines the mission, the measured machine facts, the architecture, the tool list, install/test/docs requirements, safety rules, and the definition of done. Do not re-derive or contradict its "Measured facts about this machine" section; those were measured directly in Resolve's Console.

### Hard gates, in order

1. **Step 0: research and re-plan.** Requires the **Context7** and **Exa** MCP servers. If either is missing, stop and tell the user; do not substitute generic web fetches. Outputs: `docs/research-2026-09.md`, `docs/plan-review-2026-09.md`, `docs/plan.md`. Wait for the user's explicit go-ahead before Step 1.
2. **Step 1: viability diagnostic.** Write `scripts/claude_diag.lua`, copy it to the user Utility folder, ask the user to run it from `Workspace > Scripts`, record the verbatim output in `docs/diagnostic-2026-09.md`. Decision rule: if `io.open` is a function in the script host and a file round trip works, continue; if `io` is nil there too, STOP and report the two remaining options. No workarounds for a missing `io`.
3. Only then write the bridge, server, installer, tests, and README.

Once `docs/plan.md` exists it supersedes the spec's ordering wherever they differ, provided the difference was justified in `docs/plan-review-2026-09.md`.

Architecture-level changes (replacing the file queue, changing the trust boundary, changing what runs inside Resolve) must be presented to the user as a tradeoff before proceeding. Implementation-level improvements from documentation can be adopted directly, with a note.

## Machine ground truth (verified on this Mac)

The spec's measured facts are authoritative. Additional on-disk facts verified 2026-09-20:

- **Blackmagic's scripting docs DO ship on this free-edition install**, at `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/`. The spec guesses `README.txt`; the actual files are `README.md` (last updated 31 Aug 2026), `CHANGELOG.md` (lists the 21.1 API additions), `DaVinciResolveScript.pyi` (full method signatures), `Examples/` (paired `.lua`/`.py` sample scripts, the Lua ones are the best reference for calling conventions), and `Modules/`. The README has a "Studio and AI Scripting APIs" section that marks Studio-only functions. Use these as the API reference for the `scripting_api_docs` tool and for writing tools; do not write a condensed reference from memory.
- User Utility folder exists and is empty: `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/`. This is the **only** Resolve location this project may write to.
- `fuscript` exists at `/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript`.
- Claude Desktop config exists at `~/Library/Application Support/Claude/claude_desktop_config.json` and already contains other servers. Merge into it, never clobber, back up first.
- `python3` on PATH is 3.13.5 (`/Library/Frameworks/Python.framework`); pyenv is also present. Spec requires 3.11+ in a project-local venv.
- No `lua`, `lua5.1`, or `luajit` on PATH. Homebrew is at `/opt/homebrew/bin/brew`; the Lua-side unit tests will need one installed.

## Planned architecture

```
Claude Desktop --stdio--> Python MCP server (FastMCP, server/)
                              | writes  ~/.resolve-lua-bridge/queue/req/<id>.lua
                              | polls   ~/.resolve-lua-bridge/queue/res/<id>.json
                              v
                      file queue (write to tmp/, atomic rename)
                              ^
                              | polls req/, runs chunk via loadstring+setfenv+xpcall, writes res/
                bridge/resolve_lua_bridge.lua (inside Resolve's script host,
                launched from Workspace > Scripts, holds the live `resolve`)
```

Planned layout: `bridge/` (the single dependency-free Lua file, under 600 lines), `server/` (Python package `resolve_lua_bridge`: server, protocol, tools, docs search), `scripts/` (diagnostic Lua), `tests/` (pytest with a fake bridge thread; Lua encoder tests), `install.sh`, `uninstall.sh`, `Makefile`, `README.md`.

Runtime state lives under `~/.resolve-lua-bridge/` (`bridge.json` session info, `heartbeat`, `stop` sentinel, `server.log`, `queue/{req,res,tmp}`), mode `0700`.

Key protocol decisions the spec fixes: one request in flight at a time; uuid4 request ids; heartbeat rewritten at least once per second and considered stale after 3 s; response written to `tmp/` then renamed into `res/` (with a `.done` marker fallback if `os.rename` is missing); a single-slot `req/next.lua` fallback if `io.popen` is missing for directory listing. Both fallbacks are decided by what Step 1 measures.

## Commands

None exist yet. The spec requires these targets; update this section once they are real:

```sh
make install   # runs install.sh: venv + pip install -e . + queue dirs + copy Lua files + merge Claude Desktop config
make test      # pytest for the Python side; Lua encoder tests under lua5.1/luajit if installed
make smoke     # against a live Resolve + running bridge; only touches a timeline named bridge-smoke that it creates
```

Running a single pytest test will follow the usual `pytest tests/test_x.py::test_name` once the package exists.

## Project-specific rules

These come from the spec and are not negotiable without the user's say-so.

- **stdout is the MCP transport.** The server logs to `~/.resolve-lua-bridge/server.log`, never prints.
- **No network listeners of any kind.** File queue only.
- **Never modify anything under `/Applications` or `/Library`** without asking. Prefer the user Utility folder over the system one.
- **Destructive tools** (delete markers, delete clips, overwrite render jobs, close without saving) take `confirm: bool = False` and refuse when false. During development, never run destructive Resolve operations except on timelines or projects the tests created.
- **When the user must click something in Resolve or restart Claude Desktop, stop and ask.** Do not assume it happened.
- The bridge Lua file must never call `os.exit`, never block longer than one request, and must stay dependency-free.
- Commit after each step with a clear message.

## Lua conventions the bridge and tools must respect

- Resolve's script host is **Lua 5.1** (LuaJIT). Use colon-call syntax on API objects (`resolve:GetProjectManager()`), 1-indexed tables, `return` to send a value back.
- Lua 5.1 has `setfenv`, `loadstring`, `xpcall`, but no `io.dir`; directory listing needs `io.popen` or the single-slot fallback.
- The Console sandbox and the Scripts-menu host are **different environments**. Console findings (no `io`, no `os.execute`, no `require`) do not transfer; Step 1 measures the script host.
- `bmd.*` helpers known to exist: `bmd.wait(seconds)`, `bmd.createuuid()`, `bmd.fileexists`, `bmd.direxists`, `bmd.readstring`/`bmd.writestring` (Lua table serialization). Check the spec and Step 0 research before hand-rolling something a `bmd` helper already does.
- Resolve API "lists" are 1-indexed tables and "dicts" are tables keyed by name; userdata (API objects) must be JSON-encoded as placeholder strings, never crash the encoder.
