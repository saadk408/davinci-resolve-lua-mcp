# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`resolve-lua-bridge` is an MCP server, shipped as an **MCPB bundle** for Claude Desktop, that controls **DaVinci Resolve 21.1 free edition on macOS**. Blackmagic removed Python and external scripting from the free edition in 21.1 and their native MCP server is Studio only. The one remaining door is a Lua script launched from `Workspace > Scripts` inside Resolve, which receives the live `resolve` object. That script runs as a long-lived in-app bridge and executes Lua on behalf of the server. Requests arrive as a file the bridge reads with `loadfile`; responses go back through `fusion:SetPrefs` + `fusion:SavePrefs()`, which the server reads from `Fusion.prefs` on disk. The server is **TypeScript on `@modelcontextprotocol/sdk` 1.x**, bundled by esbuild into one file and launched by the Node that ships inside Claude Desktop.

## Current state (as of 2026-09-20)

- **Step 0 is done.** `docs/plan.md` is the **single source of truth**: mission, measured ground truth, safety rules, protocol v1, repository layout, Steps 1-7 and the definition of done. `docs/plan-review-2026-09.md` is the validation record (sections A-L explain every departure from the original spec, including the user-approved architecture changes: response channel via prefs, MCPB distribution, Node/TypeScript runtime) and `docs/research-2026-09.md` holds the evidence. The original mission spec was retired on 2026-09-20 and exists only in git history (commit `73eb388`); do not look for it.
- **No code exists yet.** Step 1 (the diagnostic) starts only after the user's explicit go-ahead.
- Git repository on `main`; `.gitignore` covers `.DS_Store`, `.remember/`, `.venv/`, `node_modules/`, `dist/`, `server/`.

## Hard gates, in order

1. **Step 0: research and re-plan.** Done. Required Context7 (`resolve-library-id` + `query-docs`) and Exa; both are available in this environment.
2. **Step 1: viability diagnostic.** Write `scripts/claude_diag.lua` per `docs/plan.md`, copy it to the user Utility folder, ask the user to run it in a **scratch project**, record the result verbatim in `docs/diagnostic-2026-09.md`. **Revised decision rule (user-approved 2026-09-20):** continue iff the script observably ran, `loadfile` of `~/.resolve-lua-bridge/next.lua` returned its table and the code executed, a `SetPrefs`+`SavePrefs` write appeared in `Fusion.prefs` within 2 s, and the UI stayed responsive. A missing `io` is expected and is not a stop condition. Otherwise STOP and report the two remaining options (Studio, or GUI automation). No other workarounds.
3. Only then write the bridge, server, bundle, tests, and README, in the order of `docs/plan.md`.

Architecture-level changes (the request file, the prefs response channel, the trust boundary, what runs inside Resolve, the runtime, the distribution format) must be presented to the user as a tradeoff before proceeding. Implementation-level improvements can be adopted directly, with a note in the relevant doc.

## Machine ground truth (verified on this Mac)

The Console measurements of 2026-09-19 in `docs/plan.md` ("Ground truth: measured facts about this machine") are authoritative. Verified 2026-09-20:

- Resolve 21.1.0 build 21.1.00017, free edition. Blackmagic's scripting docs ship at `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/`: `README.md` (31 Aug 2026), `CHANGELOG.md`, `DaVinciResolveScript.pyi`, `Examples/`, `Modules/`. **The README no longer contains API tables; `DaVinciResolveScript.pyi` is the signature reference** (typed, with docstrings, 16 marker colours). Use the `.pyi` for the `scripting_api_docs` tool and when writing tools. Deprecated forms to avoid: `GetSetting/SetSetting` (use `GetSettings()/SetSettings({})`), `GetItemsInTrack` (use `GetItemListInTrack`), index-based render job calls (ids are strings), single-arg `GetClipProperty`.
- The free 21.1 Scripts-menu Lua state is sandboxed (four independent measurements, one on this build): `io`, `os.execute`, `os.remove`, `os.rename`, `require`, `package`, `ffi`, `bmd.readfile/writefile/readdir` are nil; `os` keeps `clock date difftime getenv time tmpname`; `print` output is invisible. Working: `loadfile`, `dofile`, `loadstring`, `pcall`, `bmd.wait/fileexists/direxists/createuuid/gettime/getpid/scriptapp`, the Resolve API, and `fusion:GetPrefs/SetPrefs/SavePrefs`.
- `Fusion.prefs` (the response channel) is at `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Profiles/Default/Fusion.prefs` (about 22 KB, Lua-table text, mode 0666, one profile).
- User Utility folder: `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/` (empty, user-owned). This is the **only** Resolve location this project may write to; the server self-installs its two Lua files there and nowhere else.
- `fuscript` at `/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript` runs plain Lua from a terminal with a full, unsandboxed LuaJIT (`fuscript -l lua -x '...'`). It is the Lua test runner.
- Claude Desktop 2.2553.1 (Electron 44.2.0). Extensions live in `~/Library/Application Support/Claude/Claude Extensions/<id>/`; nine registry extensions here are `type: node` launched with Claude's own Node; one local `type: uv` bundle ran only because Claude found the user's `~/.local/bin/uv`. Per-server logs: `~/Library/Logs/Claude/mcp-server-<Display Name>.log`. `claude_desktop_config.json` (mode 0600) has one other server (`notebooklm`); the developer loop merges into it, never clobbers, backs up first.
- Node v24.0.1 and v22.15.0 via nvm (`. ~/.nvm/nvm.sh`), npm 11.7.0; `@modelcontextprotocol/sdk` 1.30.0 (peer `zod ^3.25 || ^4`), esbuild 0.28.2, `@anthropic-ai/mcpb` 2.1.2 via `npx`. `/usr/bin/python3` is unusable (Xcode licence prompt); Python is not used by the server.

## Architecture (protocol v1; docs/plan.md has the full reference)

```
Claude Desktop --stdio--> MCPB "DaVinci Resolve (Lua bridge)" = node ${__dirname}/server/index.js
      | writes <state_dir>/next.lua (tmp + rename): return {v, id, session, op, ts, code=[==[...]==]}
      | polls  ~/Library/.../Fusion/Profiles/*/Fusion.prefs for RLBResp = "<id>:<hex json>"
      | deletes next.lua after the response (Lua cannot delete files)
      | first run: copies bridge/resolve_lua_bridge.lua + scripts/claude_diag.lua into the user Utility folder
      v
bridge/resolve_lua_bridge.lua (Scripts-menu Lua state, holds live `resolve`)
      loop: bmd.wait(0.05); bmd.fileexists -> loadfile -> new id & our session? ->
            loadstring+setfenv+xpcall with captured print -> SetPrefs(RLBResp)+SavePrefs
      RLBSession written once at start; no fusion: calls while idle; stop = op="stop"; takeover = session mismatch
```

Layout: `manifest.json` (MCPB v0.4), `package.json`, `tsconfig.json`, `.mcpbignore`, `src/` (`index.ts`, `server.ts` with the 15 tools, `config.ts`, `protocol.ts`, `prefs.ts`, `lua.ts`, `docsSearch.ts`, `bridgeInstall.ts`, `log.ts`), `server/index.js` (esbuild output, git-ignored, shipped), `bridge/resolve_lua_bridge.lua` (one dependency-free file, under 600 lines), `scripts/` (`claude_diag.lua`, `dev-register.mjs`, `smoke.mjs`), `tests/` (`node --test` via `tsx`; `tests/lua/` under `fuscript`), `dist/` (packed bundle, git-ignored), `Makefile`, `README.md`.

Runtime state: `RLB_STATE_DIR` (default `~/.resolve-lua-bridge/`, 0700) holding `next.lua`, `next.lua.tmp`, `lock` (pid, O_EXCL), `server.log`. No queue subdirectories, no heartbeat file, no stop file.

## Commands

None exist yet. Planned targets (update this section once they are real):

```sh
make build         # tsc --noEmit + esbuild -> server/index.js
make test          # node --test (tsx) + fuscript -l lua tests/lua/run_tests.lua + grep checks on the bridge
make bundle        # build + mcpb validate + mcpb pack . dist/resolve-lua-bridge.mcpb + mcpb info
make install       # bundle, then open the .mcpb so Claude Desktop shows its install dialog
make dev-register  # developer loop: merge a claude_desktop_config.json entry pointing at server/index.js
make smoke         # against live Resolve + running bridge; only touches a timeline named bridge-smoke it creates
make stop          # sends the stop request to the bridge
make uninstall-bridge  # removes the two Lua files from the user Utility folder
```

## Project-specific rules

Mirror of `docs/plan.md` "Safety and behaviour rules" (the original spec's rules plus those learned in Step 0). Not negotiable without the user's say-so; if the two ever differ, `docs/plan.md` wins.

- **stdout is the MCP transport.** Log with `console.error` and the file log only; `console.log` is never called anywhere in `src/`.
- **No network listeners of any kind.** Files in, prefs out.
- **Never modify anything under `/Applications` or `/Library`** without asking. The server writes to the user Utility folder only (its two Lua files) and never creates Resolve's folders; if the folder is missing it reports that through `resolve_status`. Running `fuscript` read-only is fine.
- **Destructive tools** take `confirm: bool = False` and refuse when false. Never run destructive Resolve operations during development except on timelines, bins or projects the tests created.
- **When the user must click something in Resolve or Claude Desktop, stop and ask.** Do not assume it happened.
- **Never launch the bridge loop via `fusion:Execute` or a startup `.scriptlib`** (it holds Fusion's shared script executor for the session). Scripts-menu launch only.
- **The bridge never writes prefs while idle** and never on error paths during shutdown. Prefs writes happen only in response to a request, plus one `RLBSession` at start and one on clean stop.
- The bridge never deletes files (it cannot), never calls `os.exit`, never blocks longer than one request, and stays dependency-free.
- Responses are capped (64 KB of JSON by default, 192 KB hard ceiling, before hex) because every `SavePrefs` rewrites a 22 KB file Resolve loads at startup; list tools paginate with `offset` + `limit`.
- **Every MCP tool declares `title` and `annotations`**: read-only tools `readOnlyHint: true`; `run_lua` and `delete_markers` `destructiveHint: true`; all `openWorldHint: false`. Descriptions describe; cross-tool guidance lives in the server `instructions` string, never in descriptions. Handlers never throw: every failure is an `isError` result that names the next step.
- **Every string a tool embeds in a Lua chunk goes through the one `luaString()` escaping helper.** Tool inputs are untrusted even though Claude sends them. Enums are zod enums, ints are bounded, list tools take a `limit`. The server never spawns a process.
- **The manifest's `tools[]` list stays identical to the server's `tools/list`** (a test enforces it). The manifest is `manifest_version "0.4"`, `platforms ["darwin"]`, `runtimes.node ">=20.0.0"`; code uses only Node 20 APIs.
- Framework is `@modelcontextprotocol/sdk` 1.x (`McpServer` from `server/mcp.js`, `registerTool` with zod raw shapes, `StdioServerTransport`, `InMemoryTransport` + `Client` for tests); not the v2 alpha, not Python. See `docs/plan-review-2026-09.md` §§ J-K for why.
- Commit after each step with a clear message.

## Lua conventions the bridge and tools must respect

- Lua 5.1 (LuaJIT): colon calls on API objects, 1-indexed tables, `return` to send a value back. `xpcall(f, handler)` takes no extra arguments in 5.1, so wrap calls in a closure.
- Obtain `resolve` with a plain global read (not `rawget`, a metatable on `_G` would hide it), then `Resolve()` if that is a function (the shipped examples' form), then `bmd.scriptapp("Resolve")`; if `fusion` is nil use `resolve:Fusion()`.
- Resolve "lists" are 1-indexed tables that may carry a `__flags` key (strip it; iterate with `for i = 1, #list`, never `pairs`); "dicts" are keyed by name, and some (`GetMarkers()`) by integer frame. Encoder rules: a table is a JSON array only when its keys are exactly 1..n; any other integer-keyed table is an object with string keys; a table with a metatable, userdata or a function becomes a `tostring()` placeholder, never a crash. Numbers: `%d` when integral and below 2^53, else `%.17g`; NaN/inf become null. `GetSettings()` returns the frame rate as a number and resolution as strings; `AddRenderJob()` returns `""` on failure, which is truthy in Lua, so check `#jobId > 0`; check every boolean the API returns.
- `bmd.readstring`/`bmd.writestring` are Lua-table serialisers, not file I/O.
- The Console and the Scripts-menu host are different states; the menu host is what the bridge runs in. Step 1 measures it on this Mac. Blackmagic's docs say nothing about the host's libraries, `bmd.*`, `fusion:*Prefs` or the free-edition sandbox; those facts are community-measured (research § 3) until Step 1 confirms them.
- Lua never expands `~`: build every path from `os.getenv("HOME")` or the `RLB_STATE_DIR` header the server stamps into the Lua files at copy time. Page names for `OpenPage` are lowercase. `LoadProject` on a dirty project can raise a modal the bridge cannot answer, so `open_project` saves first by default and interactive render mode stays off. The shipped `Examples/*.lua` use deprecated calls and `os.exit`; they are reference for conventions only, the `.pyi` is the signature source.
