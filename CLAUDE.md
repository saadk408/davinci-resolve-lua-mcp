# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`resolve-lua-bridge` is an MCP server that lets Claude Desktop control **DaVinci Resolve 21.1 free edition on macOS**. Blackmagic removed Python and external scripting from the free edition in 21.1 and their native MCP server is Studio only. The one remaining door is a Lua script launched from `Workspace > Scripts` inside Resolve, which receives the live `resolve` object. That script runs as a long-lived in-app bridge and executes Lua on behalf of a Python MCP server. Requests arrive as a file the bridge reads with `loadfile`; responses go back through `fusion:SetPrefs` + `fusion:SavePrefs()`, which the server reads from `Fusion.prefs` on disk.

## Current state (as of 2026-09-20)

- **Step 0 is done.** `docs/research-2026-09.md`, `docs/plan-review-2026-09.md` and `docs/plan.md` exist and are committed. `docs/plan.md` is now the authoritative ordering and protocol reference; the spec (`docs/claude-code-prompt-resolve-lua-bridge.md`) remains the source of truth for mission, safety rules and definition of done.
- **No code exists yet.** Step 1 (the diagnostic) starts only after the user's explicit go-ahead.
- Git repository on `main`; `.gitignore` covers `.DS_Store`, `.remember/`, `.venv/`.

## Hard gates, in order

1. **Step 0: research and re-plan.** Done. Required Context7 (`resolve-library-id` + `query-docs`) and Exa; both are available in this environment.
2. **Step 1: viability diagnostic.** Write `scripts/claude_diag.lua` per `docs/plan.md`, copy it to the user Utility folder, ask the user to run it in a **scratch project**, record the result verbatim in `docs/diagnostic-2026-09.md`. **Revised decision rule (user-approved 2026-09-20):** continue iff the script observably ran, `loadfile` of `~/.resolve-lua-bridge/next.lua` returned its table and the code executed, a `SetPrefs`+`SavePrefs` write appeared in `Fusion.prefs` within 2 s, and the UI stayed responsive. A missing `io` is expected and is not a stop condition. Otherwise STOP and report the two remaining options (Studio, or GUI automation). No other workarounds.
3. Only then write the bridge, server, installer, tests, and README, in the order of `docs/plan.md`.

Architecture-level changes (the request file, the prefs response channel, the trust boundary, what runs inside Resolve) must be presented to the user as a tradeoff before proceeding. Implementation-level improvements can be adopted directly, with a note in the relevant doc.

## Machine ground truth (verified on this Mac)

The spec's Console measurements (2026-09-19) are authoritative. Verified 2026-09-20:

- Resolve 21.1.0 build 21.1.00017, free edition. Blackmagic's scripting docs ship at `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/`: `README.md` (31 Aug 2026), `CHANGELOG.md`, `DaVinciResolveScript.pyi`, `Examples/`, `Modules/`. **The README no longer contains API tables; `DaVinciResolveScript.pyi` is the signature reference** (typed, with docstrings, 16 marker colours). Use the `.pyi` for the `scripting_api_docs` tool and when writing tools. Deprecated forms to avoid: `GetSetting/SetSetting` (use `GetSettings()/SetSettings({})`), `GetItemsInTrack` (use `GetItemListInTrack`), index-based render job calls (ids are strings), single-arg `GetClipProperty`.
- The free 21.1 Scripts-menu Lua state is sandboxed (four independent measurements, one on this build): `io`, `os.execute`, `os.remove`, `os.rename`, `require`, `package`, `ffi`, `bmd.readfile/writefile/readdir` are nil; `os` keeps `clock date difftime getenv time tmpname`; `print` output is invisible. Working: `loadfile`, `dofile`, `loadstring`, `pcall`, `bmd.wait/fileexists/direxists/createuuid/gettime/getpid/scriptapp`, the Resolve API, and `fusion:GetPrefs/SetPrefs/SavePrefs`.
- `Fusion.prefs` (the response channel) is at `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Profiles/Default/Fusion.prefs` (about 22 KB, Lua-table text, mode 0666, one profile).
- User Utility folder: `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/` (empty, user-owned). This is the **only** Resolve location this project may write to.
- `fuscript` at `/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript` runs plain Lua from a terminal with a full, unsandboxed LuaJIT (`fuscript -l lua -x '...'`). Use it as the Lua test runner; no Homebrew `luajit` needed.
- Claude Desktop config `~/Library/Application Support/Claude/claude_desktop_config.json` (mode 0600) has one other server (`notebooklm`). Merge, never clobber, back up first, keep 0600.
- `python3` = 3.13.5 python.org framework build at `/Library/Frameworks/Python.framework/Versions/3.13/bin/python3`. **There is no pyenv.** `uv` 0.10.12 exists but the installer uses `python3 -m venv` + `pip`.
- `mcp` on PyPI is 2.x (2.2.0): `from mcp.server import MCPServer` (FastMCP was renamed); in-memory tests via `from mcp import Client`; tool exceptions surface as `isError` results.

## Architecture (protocol v1, see docs/plan.md for the full reference)

```
Claude Desktop --stdio--> Python MCP server (MCPServer, server/)
      | writes ~/.resolve-lua-bridge/next.lua (tmp + os.replace): return {v, id, session, op, ts, code=[==[...]==]}
      | polls  ~/Library/.../Fusion/Profiles/*/Fusion.prefs for RLBResp = "<id>:<hex json>"
      | deletes next.lua after the response (Lua cannot delete files)
      v
bridge/resolve_lua_bridge.lua (Scripts-menu Lua state, holds live `resolve`)
      loop: bmd.wait(0.05); bmd.fileexists -> loadfile -> new id & our session? ->
            loadstring+setfenv+xpcall with captured print -> SetPrefs(RLBResp)+SavePrefs
      RLBSession written once at start (session uuid, pid, product, version, profile, state)
      no fusion: calls while idle; stop = a request with op="stop"; takeover = session mismatch
```

Layout: `bridge/` (one dependency-free Lua file, under 600 lines), `server/` (Python package `resolve_lua_bridge`: `server.py`, `protocol.py`, `tools.py` with 14 tools, `lua_snippets.py`, `docs_search.py`), `scripts/claude_diag.lua`, `tests/` (pytest with a fake bridge thread that writes a fake `Fusion.prefs`; Lua tests under `fuscript`), `install.sh`, `uninstall.sh`, `Makefile`, `README.md`.

Runtime state: `~/.resolve-lua-bridge/` (0700) holding `next.lua`, `next.lua.tmp`, `lock` (flock), `server.log`. No queue subdirectories, no heartbeat file, no stop file.

## Commands

None exist yet. Planned targets (update this section once they are real):

```sh
make install   # venv + pip install -e . + state dir + copy Lua files + merge Claude Desktop config
make test      # pytest + fuscript -l lua tests/lua/run_tests.lua + grep checks on the bridge
make smoke     # against live Resolve + running bridge; only touches a timeline named bridge-smoke it creates
make stop      # sends the stop request to the bridge
```

## Project-specific rules

From the spec, plus rules learned in Step 0. Not negotiable without the user's say-so.

- **stdout is the MCP transport.** The server logs to `~/.resolve-lua-bridge/server.log` and stderr, never prints.
- **No network listeners of any kind.** Files in, prefs out.
- **Never modify anything under `/Applications` or `/Library`** without asking. User Utility folder only. Running `fuscript` read-only is fine.
- **Destructive tools** take `confirm: bool = False` and refuse when false. Never run destructive Resolve operations during development except on timelines, bins or projects the tests created.
- **When the user must click something in Resolve or restart Claude Desktop, stop and ask.** Do not assume it happened.
- **Never launch the bridge loop via `fusion:Execute` or a startup `.scriptlib`** (it holds Fusion's shared script executor for the session). Scripts-menu launch only.
- **The bridge never writes prefs while idle** and never on error paths during shutdown (a queued prefs event during Resolve's teardown has crashed it). Prefs writes happen only in response to a request, plus one `RLBSession` at start and one on clean stop.
- The bridge never deletes files (it cannot), never calls `os.exit`, never blocks longer than one request, and stays dependency-free.
- Responses are capped (192 KB of JSON before hex) because every `SavePrefs` rewrites a file Resolve loads at startup.
- Commit after each step with a clear message.
- **Every MCP tool declares `title` and `ToolAnnotations`**: read-only tools `read_only_hint=True`; `run_lua` and `delete_markers` `destructive_hint=True`; all `open_world_hint=False`. Descriptions describe; cross-tool guidance lives in the server `instructions` string, never in descriptions.
- **Every string a tool embeds in a Lua chunk goes through the one `lua_string()` escaping helper.** Tool inputs are untrusted even though Claude sends them. Enums are `Literal`s, ints are bounded, list tools take a `limit`.
- Framework is the official `mcp>=2.2,<3` (`MCPServer`), not jlowin's `fastmcp`; see `docs/plan-review-2026-09.md` § J for why.

## Lua conventions the bridge and tools must respect

- Lua 5.1 (LuaJIT): colon calls on API objects, 1-indexed tables, `return` to send a value back. `xpcall(f, handler)` takes no extra arguments in 5.1, so wrap calls in a closure.
- Obtain `resolve` with `rawget(_G, "resolve")`, then `Resolve()` if that is a function, then `bmd.scriptapp("Resolve")`.
- Resolve "lists" are 1-indexed tables that may carry a `__flags` key (strip it); "dicts" are keyed by name; userdata must be encoded as placeholder strings, never crash the encoder. Numbers: `%d` when integral and below 2^53, else `%.17g`; NaN/inf become null.
- `bmd.readstring`/`bmd.writestring` are Lua-table serialisers, not file I/O.
- The Console and the Scripts-menu host are different states; the menu host is what the bridge runs in. Step 1 measures it on this Mac.
